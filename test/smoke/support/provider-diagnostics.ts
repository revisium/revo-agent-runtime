import { createRedactionChannel } from '../../../src/execution/security/redaction/channel.js';

const MAX_TEXT_BYTES = 2_048;
const MAX_JSON_BYTES = 8_192;
const MAX_OBSERVATIONS = 64;
const MAX_ARRAY_ITEMS = 16;
const MAX_OBJECT_KEYS = 32;
const MAX_DEPTH = 4;

export type DiagnosticPhase =
  | 'discovery'
  | 'inspect'
  | 'open'
  | 'configuration'
  | 'prompt'
  | 'result'
  | 'close';
type DiagnosticSource =
  | 'acp.error'
  | 'acp.update'
  | 'acp.result'
  | 'stderr'
  | 'exit'
  | 'runtime.fault';

export interface ProviderDiagnosticTrace {
  readonly closeReceived?: boolean;
  readonly exited?: boolean;
  readonly exitCode?: number | null;
  readonly exitSignal?: string | null;
  readonly outbound?: readonly Record<string, unknown>[];
  readonly stderr?: readonly string[];
}

export interface ProviderDiagnosticCapture {
  readonly schemaVersion: 'provider-diagnostic/v1';
  readonly caseId: string;
  readonly agent: { readonly id: string; readonly version: string };
  readonly model?: string;
  readonly selections?: Readonly<Record<string, string | boolean>>;
  readonly phase: DiagnosticPhase;
  readonly truncation: { readonly truncated: boolean; readonly droppedObservations: number };
  readonly observations: readonly DiagnosticObservation[];
  readonly publicResult: unknown;
}

type DiagnosticObservation = Readonly<{
  readonly source: DiagnosticSource;
  readonly phase?: DiagnosticPhase;
  readonly id?: number | string;
  readonly method?: string;
  readonly code?: number | string;
  readonly message?: string;
  readonly stopReason?: string;
  readonly data?: unknown;
}>;

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const truncateUtf8 = (value: string, maxBytes: number): { value: string; truncated: boolean } => {
  const bytes = encoder.encode(value);
  if (bytes.byteLength <= maxBytes) return { value, truncated: false };
  let end = maxBytes;
  while (end > 0 && encoder.encode(decoder.decode(bytes.slice(0, end))).byteLength > maxBytes)
    end -= 1;
  return { value: decoder.decode(bytes.slice(0, end)), truncated: true };
};
const redactText = (value: string, secrets: readonly string[], maxBytes = MAX_TEXT_BYTES) => {
  const channel = createRedactionChannel(secrets);
  try {
    const redacted = `${decoder.decode(channel.feed(encoder.encode(value)))}${decoder.decode(channel.flush())}`;
    return truncateUtf8(redacted, maxBytes);
  } finally {
    channel.dispose();
  }
};
const redactHeadTail = (value: string, secrets: readonly string[], maxBytes = MAX_TEXT_BYTES) => {
  const redacted = redactText(value, secrets, Number.MAX_SAFE_INTEGER);
  if (!redacted.truncated && encoder.encode(redacted.value).byteLength <= maxBytes) return redacted;
  const bytes = encoder.encode(redacted.value);
  const marker = '\n…[stderr truncated]…\n';
  const markerBytes = encoder.encode(marker).byteLength;
  const available = Math.max(0, maxBytes - markerBytes);
  const head = decoder.decode(bytes.slice(0, Math.floor(available / 2)));
  const tail = decoder.decode(bytes.slice(-Math.ceil(available / 2)));
  return { ...truncateUtf8(`${head}${marker}${tail}`, maxBytes), truncated: true };
};
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
type Bounds = { truncated: boolean; droppedObservations: number };
const redactValue = (
  value: unknown,
  secrets: readonly string[],
  bounds: Bounds,
  seen = new WeakSet<object>(),
  depth = 0,
): unknown => {
  if (typeof value === 'string') {
    const result = redactText(value, secrets);
    bounds.truncated ||= result.truncated;
    return result.value;
  }
  if (depth > MAX_DEPTH) {
    bounds.truncated = true;
    return { truncated: true, reason: 'depth' };
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_ITEMS) bounds.truncated = true;
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((entry) => redactValue(entry, secrets, bounds, seen, depth + 1));
  }
  if (!isRecord(value)) return value;
  if (seen.has(value)) {
    bounds.truncated = true;
    return { truncated: true, reason: 'cycle' };
  }
  seen.add(value);
  const entries = Object.entries(value);
  if (entries.length > MAX_OBJECT_KEYS) bounds.truncated = true;
  return Object.fromEntries(
    entries.slice(0, MAX_OBJECT_KEYS).map(([key, child]) => {
      const redactedKey = redactText(key, secrets);
      bounds.truncated ||= redactedKey.truncated;
      return [redactedKey.value, redactValue(child, secrets, bounds, seen, depth + 1)];
    }),
  );
};
const bounded = (value: unknown, secrets: readonly string[], bounds: Bounds): unknown => {
  if (value === undefined) return undefined;
  const redacted = redactValue(value, secrets, bounds);
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(redacted);
  } catch {
    bounds.truncated = true;
    return { truncated: true, reason: 'unsupported' };
  }
  if (serialized === undefined) {
    bounds.truncated = true;
    return { truncated: true, reason: 'unsupported' };
  }
  const result = truncateUtf8(serialized, MAX_JSON_BYTES);
  if (!result.truncated) return redacted;
  bounds.truncated = true;
  return { truncated: true, preview: result.value, reason: 'bytes' };
};
const stringValue = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;
const numberOrString = (value: unknown): number | string | undefined =>
  typeof value === 'number' || typeof value === 'string' ? value : undefined;
const boundedText = (value: string, secrets: readonly string[], bounds: Bounds): string => {
  const redacted = redactText(value, secrets);
  bounds.truncated ||= redacted.truncated;
  return redacted.value;
};
const responsePreview = (value: Record<string, unknown>): string | undefined => {
  if (typeof value.text === 'string') return value.text;
  if (!isRecord(value.message)) return undefined;
  const content = value.message.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return undefined;
  const text = content.find(
    (entry) => isRecord(entry) && entry.type === 'text' && typeof entry.text === 'string',
  );
  return isRecord(text) && typeof text.text === 'string' ? text.text : undefined;
};
const publicOutcome = (value: unknown, secrets: readonly string[], bounds: Bounds): unknown => {
  if (!isRecord(value)) return undefined;
  const result: Record<string, unknown> = {};
  for (const key of ['status', 'stopReason', 'code', 'message'] as const) {
    const candidate = value[key];
    if (typeof candidate === 'string' || typeof candidate === 'number')
      result[key] =
        typeof candidate === 'string' ? boundedText(candidate, secrets, bounds) : candidate;
  }
  if (isRecord(value.error)) result.error = bounded(value.error, secrets, bounds);
  if (value.status === 'succeeded' || value.status === 'completed') {
    const preview = responsePreview(isRecord(value.result) ? value.result : value);
    if (preview !== undefined)
      result.unexpectedResponsePreview = boundedText(preview, secrets, bounds);
  }
  return result;
};
const addObservation = (
  observations: DiagnosticObservation[],
  observation: DiagnosticObservation,
  bounds: Bounds,
): void => {
  if (observations.length >= MAX_OBSERVATIONS) {
    bounds.truncated = true;
    bounds.droppedObservations += 1;
    return;
  }
  observations.push(observation);
};

export const captureProviderDiagnostics = (input: {
  readonly caseId: string;
  readonly agent: { readonly id: string; readonly version: string };
  readonly phase: DiagnosticPhase;
  readonly trace: ProviderDiagnosticTrace;
  readonly publicResult: unknown;
  readonly secrets?: readonly string[];
  readonly model?: string;
  readonly selections?: Readonly<Record<string, string | boolean>>;
}): ProviderDiagnosticCapture => {
  const secrets = input.secrets ?? [];
  const bounds: Bounds = { droppedObservations: 0, truncated: false };
  const observations: DiagnosticObservation[] = [];
  for (const frame of input.trace.outbound ?? []) {
    const params = isRecord(frame.params) ? frame.params : undefined;
    const update = params && isRecord(params.update) ? params.update : undefined;
    const result = isRecord(frame.result) ? frame.result : undefined;
    const error = isRecord(frame.error)
      ? frame.error
      : isRecord(update?.error)
        ? update.error
        : isRecord(result?.error)
          ? result.error
          : undefined;
    const source: DiagnosticSource = frame.error
      ? 'acp.error'
      : update?.error
        ? 'acp.update'
        : 'acp.result';
    const frameMethod = stringValue(frame.method);
    const frameId = numberOrString(frame.id);
    const stopReason = stringValue(frame.stopReason ?? result?.stopReason);
    const toolStatus = stringValue(update?.status);
    if (error) {
      const code = numberOrString(error.code);
      const message = stringValue(error.message);
      addObservation(
        observations,
        {
          ...(code === undefined
            ? {}
            : { code: typeof code === 'string' ? boundedText(code, secrets, bounds) : code }),
          ...(frameId === undefined
            ? {}
            : {
                id: typeof frameId === 'string' ? boundedText(frameId, secrets, bounds) : frameId,
              }),
          ...(frameMethod === undefined
            ? {}
            : { method: boundedText(frameMethod, secrets, bounds) }),
          ...(message === undefined ? {} : { message: boundedText(message, secrets, bounds) }),
          data: bounded(error.data, secrets, bounds),
          phase: input.phase,
          source,
        },
        bounds,
      );
    }
    if (stopReason !== undefined)
      addObservation(
        observations,
        {
          ...(frameId === undefined
            ? {}
            : {
                id: typeof frameId === 'string' ? boundedText(frameId, secrets, bounds) : frameId,
              }),
          ...(frameMethod === undefined
            ? {}
            : { method: boundedText(frameMethod, secrets, bounds) }),
          phase: input.phase,
          source: 'acp.result',
          stopReason: boundedText(stopReason, secrets, bounds),
        },
        bounds,
      );
    if (toolStatus === 'failed')
      addObservation(
        observations,
        {
          data: bounded(update, secrets, bounds),
          ...(frameId === undefined
            ? {}
            : {
                id: typeof frameId === 'string' ? boundedText(frameId, secrets, bounds) : frameId,
              }),
          ...(frameMethod === undefined
            ? {}
            : { method: boundedText(frameMethod, secrets, bounds) }),
          phase: input.phase,
          source: 'acp.update',
        },
        bounds,
      );
  }
  if ((input.trace.stderr ?? []).length > 0) {
    const redacted = redactHeadTail((input.trace.stderr ?? []).join(''), secrets);
    bounds.truncated ||= redacted.truncated;
    addObservation(
      observations,
      { message: redacted.value, phase: input.phase, source: 'stderr' },
      bounds,
    );
  }
  if (input.trace.exited !== undefined)
    addObservation(
      observations,
      {
        data: {
          exited: input.trace.exited,
          ...(input.trace.exitCode === undefined ? {} : { code: input.trace.exitCode }),
          ...(input.trace.exitSignal === undefined ? {} : { signal: input.trace.exitSignal }),
        },
        phase: 'close',
        source: 'exit',
      },
      bounds,
    );
  if (isRecord(input.publicResult) && 'error' in input.publicResult)
    addObservation(
      observations,
      {
        data: bounded(input.publicResult.error, secrets, bounds),
        phase: input.phase,
        source: 'runtime.fault',
      },
      bounds,
    );
  return {
    agent: input.agent,
    caseId: input.caseId,
    ...(input.model === undefined ? {} : { model: input.model }),
    ...(input.selections === undefined ? {} : { selections: input.selections }),
    observations,
    phase: input.phase,
    publicResult: publicOutcome(input.publicResult, secrets, bounds),
    schemaVersion: 'provider-diagnostic/v1',
    truncation: { droppedObservations: bounds.droppedObservations, truncated: bounds.truncated },
  };
};
