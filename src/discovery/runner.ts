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

export const runDetectors = async (
  detectors: readonly AgentDetector[],
  options: DiscoverAgentsOptions,
): Promise<AgentDiscoveryResult> => {
  const disabled = new Set(options.disabledDetectorIds ?? []);
  const signal = options.signal ?? new AbortController().signal;
  const selected = [...detectors]
    .filter((detector) => !disabled.has(detector.id))
    .sort((left, right) => compareUtf8(left.id, right.id));
  const definitions: AgentDiscoveryResult['definitions'][number][] = [];
  const diagnostics: AgentDiscoveryResult['diagnostics'][number][] = [];
  const modelObservations: ModelObservation[] = [];
  const identities = new Map<string, Set<string>>();
  const active = signal.aborted ? [] : selected;
  const detectorRuns: readonly DetectorRun[] = await Promise.all(
    active.map(async (detector): Promise<DetectorRun> => {
      try {
        return Object.freeze({
          detector,
          failed: false,
          result: await detector.detect(Object.freeze({ signal })),
        });
      } catch {
        return Object.freeze({ detector, failed: true, result: undefined });
      }
    }),
  );

  for (const { detector, failed, result } of detectorRuns) {
    if (failed) {
      diagnostics.push(detectorFailure(detector.id));
      continue;
    }
    try {
      if (
        !isRecord(result) ||
        !Array.isArray(result.diagnostics) ||
        !Array.isArray(result.candidates)
      )
        throw new TypeError('Malformed detector result');
      for (const diagnostic of result.diagnostics) {
        if (!isDiagnostic(diagnostic)) throw new TypeError('Malformed detector diagnostic');
        diagnostics.push(diagnosticFor(detector.id, diagnostic));
      }
      for (const candidate of result.candidates) {
        if (
          !isRecord(candidate) ||
          !Array.isArray(candidate.models) ||
          !('definition' in candidate)
        ) {
          diagnostics.push(malformedDefinition(detector.id));
          continue;
        }
        try {
          const definition = validateAgentDefinition(candidate.definition).definition;
          const models = normalizedModels(candidate.models);
          const knownVersions = identities.get(definition.id);
          if (knownVersions?.has(definition.version) === true) {
            diagnostics.push(
              diagnosticFor(detector.id, {
                code: 'duplicate_definition',
                message: 'Detector returned a duplicate exact agent definition.',
                severity: 'warning',
              }),
            );
            continue;
          }
          if (knownVersions === undefined)
            identities.set(definition.id, new Set([definition.version]));
          else knownVersions.add(definition.version);
          const definitionIndex = definitions.length;
          definitions.push(definition);
          const defaultModelId =
            typeof candidate.defaultModelId === 'string'
              ? candidate.defaultModelId.trim()
              : undefined;
          if (models.length > 0) {
            modelObservations.push(
              Object.freeze({
                detectorId: detector.id,
                definitionIndex,
                models,
                ...(defaultModelId !== undefined && models.some(({ id }) => id === defaultModelId)
                  ? { defaultModelId }
                  : {}),
              }),
            );
          }
        } catch {
          diagnostics.push(malformedDefinition(detector.id));
        }
      }
    } catch {
      diagnostics.push(detectorFailure(detector.id));
    }
  }

  return Object.freeze({
    definitions: Object.freeze(definitions),
    diagnostics: Object.freeze(diagnostics),
    modelObservations: Object.freeze(modelObservations),
  });
};
