import { AgentManagerError } from '../../../../contracts/manager.js';
import type {
  AgentSessionLimits,
  AgentSessionManagerLimits,
} from '../../../../contracts/session.js';
import { inspectAndCopyPlainJson, isJsonObject } from '../../../../definition/canonical-json.js';
import { agentSessionLimitPolicies, agentSessionManagerLimitPolicies } from './defaults.js';

export type EffectiveAgentSessionManagerLimits = Required<AgentSessionManagerLimits>;
export type EffectiveAgentSessionLimits = Required<AgentSessionLimits>;

interface LimitPolicy {
  readonly minimum: number;
  readonly maximum: number;
  readonly default: number;
}

type Policies = Readonly<Record<string, LimitPolicy>>;

const invalidLimits = (): never => {
  throw new AgentManagerError(
    Object.freeze({
      code: 'revo.agent.limit_invalid',
      message: 'Agent session limit is invalid.',
      phase: 'session_opening',
      retryable: false,
    }),
  );
};

const plainRecord = (value: unknown): Readonly<Record<string, unknown>> => {
  if (value === undefined) return {};
  try {
    const inspected = inspectAndCopyPlainJson(value);
    if (!isJsonObject(inspected.copy)) return invalidLimits();
    return inspected.copy;
  } catch {
    return invalidLimits();
  }
};

const assertKnown = (input: Readonly<Record<string, unknown>>, policies: Policies): void => {
  if (Object.keys(input).some((key) => !Object.hasOwn(policies, key))) return invalidLimits();
};

const readLimit = (
  input: Readonly<Record<string, unknown>>,
  name: string,
  policy: LimitPolicy,
): number => {
  const candidate = input[name] ?? policy.default;
  if (
    !Number.isSafeInteger(candidate) ||
    Number(candidate) < policy.minimum ||
    Number(candidate) > policy.maximum
  )
    return invalidLimits();
  return Number(candidate);
};

export const resolveAgentSessionManagerLimits = (
  value: unknown,
): EffectiveAgentSessionManagerLimits => {
  const input = plainRecord(value);
  assertKnown(input, agentSessionManagerLimitPolicies);
  const limits = Object.freeze({
    activeStateOperationTimeoutMs: readLimit(
      input,
      'activeStateOperationTimeoutMs',
      agentSessionManagerLimitPolicies.activeStateOperationTimeoutMs,
    ),
    maxActiveSessions: readLimit(
      input,
      'maxActiveSessions',
      agentSessionManagerLimitPolicies.maxActiveSessions,
    ),
    maxCompletedSessions: readLimit(
      input,
      'maxCompletedSessions',
      agentSessionManagerLimitPolicies.maxCompletedSessions,
    ),
    maxOpeningSessions: readLimit(
      input,
      'maxOpeningSessions',
      agentSessionManagerLimitPolicies.maxOpeningSessions,
    ),
    maxSessionIdentities: readLimit(
      input,
      'maxSessionIdentities',
      agentSessionManagerLimitPolicies.maxSessionIdentities,
    ),
    recoveryTimeoutMs: readLimit(
      input,
      'recoveryTimeoutMs',
      agentSessionManagerLimitPolicies.recoveryTimeoutMs,
    ),
  });
  if (limits.maxSessionIdentities < limits.maxActiveSessions + limits.maxOpeningSessions)
    return invalidLimits();
  return limits;
};

export const resolveAgentSessionLimits = (value: unknown): EffectiveAgentSessionLimits => {
  const input = plainRecord(value);
  assertKnown(input, agentSessionLimitPolicies);
  const read = (name: keyof typeof agentSessionLimitPolicies): number =>
    readLimit(input, name, agentSessionLimitPolicies[name]);
  const limits = Object.freeze({
    eventSinkTimeoutMs: read('eventSinkTimeoutMs'),
    idleTimeoutMs: read('idleTimeoutMs'),
    maxCheckpointBytes: read('maxCheckpointBytes'),
    maxEventBytes: read('maxEventBytes'),
    maxInteractionBytes: read('maxInteractionBytes'),
    maxMessageBytes: read('maxMessageBytes'),
    maxMetadataBytes: read('maxMetadataBytes'),
    maxOutputBytes: read('maxOutputBytes'),
    maxPendingInteractions: read('maxPendingInteractions'),
    maxPromptBytes: read('maxPromptBytes'),
    openingTimeoutMs: read('openingTimeoutMs'),
    operationTimeoutMs: read('operationTimeoutMs'),
    wallClockTimeoutMs: read('wallClockTimeoutMs'),
  });
  if (
    limits.openingTimeoutMs > limits.wallClockTimeoutMs ||
    limits.idleTimeoutMs > limits.wallClockTimeoutMs ||
    limits.operationTimeoutMs > limits.wallClockTimeoutMs ||
    limits.eventSinkTimeoutMs > limits.operationTimeoutMs
  )
    return invalidLimits();
  return limits;
};
