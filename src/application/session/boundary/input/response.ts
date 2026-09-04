import type { JsonObject } from '../../../../contracts/agent-definition.js';
import { AgentManagerError } from '../../../../contracts/manager.js';
import type {
  AgentSessionInputValue,
  AgentSessionInteractiveResponse,
  RespondAgentSessionRequest,
} from '../../../../contracts/session.js';
import { isJsonObject } from '../../../../definition/canonical-json.js';
import { decodeImmutableJsonObject, hasExactJsonKeys } from './immutable-json.js';

interface ResponseInputLimits {
  readonly maxInteractionBytes: number;
}

const invalid = (): never => {
  throw new AgentManagerError(
    Object.freeze({
      code: 'revo.agent.interaction_invalid',
      message: 'Agent session interaction response is invalid.',
      phase: 'session_running',
      retryable: false,
    }),
  );
};

const inputValue = (value: unknown): AgentSessionInputValue => {
  if (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
    return value;
  if (!Array.isArray(value)) return invalid();
  const strings: string[] = [];
  for (const item of value as readonly unknown[]) {
    if (typeof item !== 'string') return invalid();
    strings.push(item);
  }
  return Object.freeze(strings);
};

const permissionResponse = (value: Readonly<JsonObject>): AgentSessionInteractiveResponse => {
  if (value.outcome === 'selected') {
    if (
      !hasExactJsonKeys(value, ['kind', 'optionId', 'outcome']) ||
      typeof value.optionId !== 'string' ||
      value.optionId.length === 0
    )
      return invalid();
    return Object.freeze({ kind: 'permission', optionId: value.optionId, outcome: 'selected' });
  }
  if (value.outcome === 'denied') {
    if (!hasExactJsonKeys(value, ['kind', 'outcome'])) return invalid();
    return Object.freeze({ kind: 'permission', outcome: 'denied' });
  }
  return invalid();
};

const inputResponse = (value: Readonly<JsonObject>): AgentSessionInteractiveResponse => {
  if (value.outcome === 'submitted') {
    if (!hasExactJsonKeys(value, ['kind', 'outcome', 'values']) || !isJsonObject(value.values))
      return invalid();
    const values: Record<string, AgentSessionInputValue> = {};
    for (const [key, answer] of Object.entries(value.values)) values[key] = inputValue(answer);
    return Object.freeze({ kind: 'input', outcome: 'submitted', values: Object.freeze(values) });
  }
  if (value.outcome === 'declined' || value.outcome === 'cancelled') {
    if (!hasExactJsonKeys(value, ['kind', 'outcome'])) return invalid();
    return Object.freeze({ kind: 'input', outcome: value.outcome });
  }
  return invalid();
};

const response = (value: unknown): AgentSessionInteractiveResponse => {
  if (!isJsonObject(value) || typeof value.kind !== 'string' || typeof value.outcome !== 'string')
    return invalid();
  if (value.kind === 'permission') return permissionResponse(value);
  if (value.kind === 'input') return inputResponse(value);
  return invalid();
};

export const decodeRespondAgentSessionRequest = (
  input: unknown,
  limits: ResponseInputLimits,
): RespondAgentSessionRequest => {
  try {
    const value = decodeImmutableJsonObject(input, {
      maxBytes: limits.maxInteractionBytes,
      maxDepth: 16,
      maxNodes: 4_096,
    });
    if (!hasExactJsonKeys(value, ['requestId', 'response'])) return invalid();
    return Object.freeze({
      requestId:
        typeof value.requestId === 'string' && value.requestId.length > 0
          ? value.requestId
          : invalid(),
      response: response(value.response),
    });
  } catch (error: unknown) {
    if (error instanceof AgentManagerError) throw error;
    return invalid();
  }
};
