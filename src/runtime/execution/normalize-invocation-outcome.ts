import { AGENT_MANAGER_LIMITS } from '../policy/index.js';
import type { AgentValidationDetails, JsonObject, JsonValue } from '../spec/index.js';
import type { InvocationTerminalObservation } from './execution-terminal-observation.js';
import type { NormalizedInvocationFailureReason } from './normalized-invocation-failure-reason.js';
import type { NormalizedInvocationOutcome } from './normalized-invocation-outcome.js';
import type { RawResponseDiagnostic } from './raw-response-diagnostic.js';
import type { ResultSchemaValidator } from './result-schema-validator.js';

const decoder = new TextDecoder('utf-8', { fatal: true });

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isJsonArray = (value: JsonValue): value is readonly JsonValue[] => Array.isArray(value);

const freezeJsonValue = (root: JsonValue): void => {
  const frames: Array<Readonly<{ value: JsonValue; visited: boolean }>> = [
    Object.freeze({ value: root, visited: false }),
  ];
  while (frames.length > 0) {
    const frame = frames.pop();
    if (frame === undefined || frame.value === null || typeof frame.value !== 'object') continue;
    if (frame.visited) {
      Object.freeze(frame.value);
      continue;
    }
    frames.push(Object.freeze({ value: frame.value, visited: true }));
    const children = isJsonArray(frame.value) ? frame.value : Object.values(frame.value);
    for (const child of children) frames.push(Object.freeze({ value: child, visited: false }));
  }
};

const rawResponseDiagnostic = (byteLength: number): RawResponseDiagnostic =>
  Object.freeze({
    byteLength,
    truncated: byteLength > AGENT_MANAGER_LIMITS.maxRawResponseBytes.default,
  });

const failure = (
  reason: NormalizedInvocationFailureReason,
  input: Readonly<{
    diagnostics?: AgentValidationDetails;
    rawResponse?: RawResponseDiagnostic;
  }> = Object.freeze({}),
): NormalizedInvocationOutcome =>
  Object.freeze({
    status: 'failed',
    reason,
    ...(input.diagnostics === undefined ? {} : { diagnostics: input.diagnostics }),
    ...(input.rawResponse === undefined ? {} : { rawResponse: input.rawResponse }),
  });

const parseObjectResponse = (
  rawResponse: Uint8Array | undefined,
  validator: ResultSchemaValidator,
): NormalizedInvocationOutcome => {
  const diagnostic = rawResponseDiagnostic(rawResponse?.byteLength ?? 0);
  if (rawResponse === undefined) return failure('response_missing', { rawResponse: diagnostic });
  if (rawResponse.byteLength === 0) return failure('response_empty', { rawResponse: diagnostic });
  if (diagnostic.truncated) return failure('response_too_large', { rawResponse: diagnostic });

  let text: string;
  try {
    text = decoder.decode(new Uint8Array(rawResponse));
  } catch {
    return failure('response_invalid_utf8', { rawResponse: diagnostic });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return failure('response_invalid_json', { rawResponse: diagnostic });
  }
  if (!isJsonObject(parsed)) {
    return failure(Array.isArray(parsed) ? 'response_json_array' : 'response_json_primitive', {
      rawResponse: diagnostic,
    });
  }

  freezeJsonValue(parsed);
  try {
    const diagnostics = validator.validate(parsed);
    if (diagnostics !== undefined)
      return failure('response_schema_mismatch', { diagnostics, rawResponse: diagnostic });
  } catch {
    return failure('response_schema_validation_failed', { rawResponse: diagnostic });
  }
  return Object.freeze({ status: 'succeeded', value: parsed });
};

export const normalizeInvocationOutcome = (
  observation: InvocationTerminalObservation,
  validator: ResultSchemaValidator,
): NormalizedInvocationOutcome => {
  if (observation.status === 'cancelled') return Object.freeze({ status: 'cancelled' });
  if (observation.status === 'failed') return failure('execution_failed');
  return parseObjectResponse(observation.rawResponse, validator);
};
