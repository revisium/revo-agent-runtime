import type {
  AgentDetector,
  AgentDiscoveryDiagnostic,
  AgentDiscoveryResult,
  DiscoverAgentsOptions,
  DiscoveredAgentModel,
  ModelObservation,
} from '../contracts/discovery.js';
import { validateAgentDefinition } from '../definition/index.js';
import { compareUtf8 } from '../definition/utf8-order.js';

const diagnosticLimit = 256;

const bounded = (value: string): string => value.slice(0, diagnosticLimit);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isDiagnostic = (value: unknown): value is AgentDiscoveryDiagnostic =>
  isRecord(value) &&
  (value.severity === 'info' || value.severity === 'warning' || value.severity === 'error') &&
  typeof value.code === 'string' &&
  typeof value.message === 'string';

const diagnosticFor = (
  detectorId: string,
  diagnostic: AgentDiscoveryDiagnostic,
): AgentDiscoveryDiagnostic & { readonly detectorId: string } =>
  Object.freeze({
    code: bounded(diagnostic.code),
    detectorId,
    message: bounded(diagnostic.message),
    severity: diagnostic.severity,
  });

const normalizedModels = (
  models: readonly DiscoveredAgentModel[],
): readonly DiscoveredAgentModel[] => {
  const byId = new Map<string, DiscoveredAgentModel>();
  for (const model of models) {
    const id = model.id.trim();
    if (id.length === 0 || byId.has(id)) continue;
    const displayName = model.displayName?.trim();
    byId.set(
      id,
      Object.freeze({
        id,
        ...(displayName === undefined || displayName.length === 0 ? {} : { displayName }),
      }),
    );
  }
  return Object.freeze([...byId.values()].sort((left, right) => compareUtf8(left.id, right.id)));
};

const detectorFailure = (detectorId: string) =>
  diagnosticFor(detectorId, {
    code: 'detector_failed',
    message: 'Detector failed without returning discovery data.',
    severity: 'error',
  });

const malformedDefinition = (detectorId: string) =>
  diagnosticFor(detectorId, {
    code: 'definition_invalid',
    message: 'Detector returned an invalid agent definition.',
    severity: 'error',
  });

interface DetectorRun {
  readonly detector: AgentDetector;
  readonly failed: boolean;
  readonly result: unknown;
}

interface DiscoveryState {
  readonly definitions: AgentDiscoveryResult['definitions'][number][];
  readonly diagnostics: AgentDiscoveryResult['diagnostics'][number][];
  readonly modelObservations: ModelObservation[];
  readonly identities: Map<string, Set<string>>;
}

interface CandidateRecord extends Record<string, unknown> {
  readonly definition: unknown;
  readonly models: readonly DiscoveredAgentModel[];
}

const isCandidateRecord = (value: unknown): value is CandidateRecord =>
  isRecord(value) && Array.isArray(value.models) && 'definition' in value;

const selectDetectors = (
  detectors: readonly AgentDetector[],
  disabled: ReadonlySet<string>,
): readonly AgentDetector[] => {
  return [...detectors]
    .filter((detector) => !disabled.has(detector.id))
    .sort((left, right) => compareUtf8(left.id, right.id));
};

const runDetector = async (detector: AgentDetector, signal: AbortSignal): Promise<DetectorRun> => {
  try {
    return Object.freeze({
      detector,
      failed: false,
      result: await detector.detect(Object.freeze({ signal })),
    });
  } catch {
    return Object.freeze({ detector, failed: true, result: undefined });
  }
};

const runSelectedDetectors = async (
  detectors: readonly AgentDetector[],
  signal: AbortSignal,
): Promise<readonly DetectorRun[]> =>
  Promise.all(detectors.map((detector) => runDetector(detector, signal)));

const newDiscoveryState = (): DiscoveryState => ({
  definitions: [],
  diagnostics: [],
  modelObservations: [],
  identities: new Map(),
});

const appendModelObservation = (
  detectorId: string,
  definitionIndex: number,
  models: readonly DiscoveredAgentModel[],
  defaultModelId: string | undefined,
  state: DiscoveryState,
): void => {
  if (models.length === 0) return;
  state.modelObservations.push(
    Object.freeze({
      detectorId,
      definitionIndex,
      models,
      ...(defaultModelId !== undefined && models.some(({ id }) => id === defaultModelId)
        ? { defaultModelId }
        : {}),
    }),
  );
};

const appendCandidate = (
  detectorId: string,
  candidate: CandidateRecord,
  state: DiscoveryState,
): void => {
  const definition = validateAgentDefinition(candidate.definition).definition;
  const models = normalizedModels(candidate.models);
  const knownVersions = state.identities.get(definition.id);
  if (knownVersions?.has(definition.version) === true) {
    state.diagnostics.push(
      diagnosticFor(detectorId, {
        code: 'duplicate_definition',
        message: 'Detector returned a duplicate exact agent definition.',
        severity: 'warning',
      }),
    );
    return;
  }
  if (knownVersions === undefined)
    state.identities.set(definition.id, new Set([definition.version]));
  else knownVersions.add(definition.version);
  const definitionIndex = state.definitions.length;
  state.definitions.push(definition);
  const defaultModelId =
    typeof candidate.defaultModelId === 'string' ? candidate.defaultModelId.trim() : undefined;
  appendModelObservation(detectorId, definitionIndex, models, defaultModelId, state);
};

const processCandidate = (detectorId: string, candidate: unknown, state: DiscoveryState): void => {
  if (!isCandidateRecord(candidate)) {
    state.diagnostics.push(malformedDefinition(detectorId));
    return;
  }
  try {
    appendCandidate(detectorId, candidate, state);
  } catch {
    state.diagnostics.push(malformedDefinition(detectorId));
  }
};

const processDetectorResult = (
  detectorId: string,
  result: unknown,
  state: DiscoveryState,
): void => {
  if (!isRecord(result) || !Array.isArray(result.diagnostics) || !Array.isArray(result.candidates))
    throw new TypeError('Malformed detector result');
  for (const diagnostic of result.diagnostics) {
    if (!isDiagnostic(diagnostic)) throw new TypeError('Malformed detector diagnostic');
    state.diagnostics.push(diagnosticFor(detectorId, diagnostic));
  }
  for (const candidate of result.candidates) processCandidate(detectorId, candidate, state);
};

const processDetectorRun = (run: DetectorRun, state: DiscoveryState): void => {
  if (run.failed) {
    state.diagnostics.push(detectorFailure(run.detector.id));
    return;
  }
  try {
    processDetectorResult(run.detector.id, run.result, state);
  } catch {
    state.diagnostics.push(detectorFailure(run.detector.id));
  }
};

const freezeDiscoveryState = (state: DiscoveryState): AgentDiscoveryResult =>
  Object.freeze({
    definitions: Object.freeze(state.definitions),
    diagnostics: Object.freeze(state.diagnostics),
    modelObservations: Object.freeze(state.modelObservations),
  });

export const runDetectors = async (
  detectors: readonly AgentDetector[],
  options: DiscoverAgentsOptions,
): Promise<AgentDiscoveryResult> => {
  const disabled = new Set(options.disabledDetectorIds ?? []);
  const signal = options.signal ?? new AbortController().signal;
  const selected = selectDetectors(detectors, disabled);
  const active = signal.aborted ? [] : selected;
  const detectorRuns = await runSelectedDetectors(active, signal);
  const state = newDiscoveryState();
  for (const detectorRun of detectorRuns) processDetectorRun(detectorRun, state);
  return freezeDiscoveryState(state);
};
