import { AgentManagerError } from '../../contracts/manager.js';
import { fault } from '../faults/agent-faults.js';

export class LimitValidationError extends Error {}

interface LimitPolicy {
  readonly default: number;
  readonly maximum: number;
  readonly minimum: number;
}

interface DeadlineLimits {
  readonly idleTimeoutMs: number;
  readonly wallClockTimeoutMs: number;
}

export interface EffectiveLimits extends DeadlineLimits {
  readonly activeStateOperationTimeoutMs: number;
  readonly initializationTimeoutMs: number;
  readonly maxCompletedInvocations: number;
  readonly maxEventBytes: number;
  readonly maxEventsFileBytes: number;
  readonly maxRawResponseBytes: number;
  readonly maxStderrBytes: number;
  readonly maxStdoutBytes: number;
}

type LimitName = keyof EffectiveLimits;
type LimitDefaults = DeadlineLimits & Partial<Omit<EffectiveLimits, keyof DeadlineLimits>>;

const limitPolicies: Readonly<Record<LimitName, LimitPolicy>> = Object.freeze({
  activeStateOperationTimeoutMs: Object.freeze({ default: 10_000, maximum: 30_000, minimum: 100 }),
  idleTimeoutMs: Object.freeze({ default: 300_000, maximum: 300_000, minimum: 1_000 }),
  initializationTimeoutMs: Object.freeze({
    default: 120_000,
    maximum: 1_800_000,
    minimum: 1_000,
  }),
  maxCompletedInvocations: Object.freeze({ default: 1_000, maximum: 1_000, minimum: 1 }),
  maxEventBytes: Object.freeze({ default: 65_536, maximum: 65_536, minimum: 1_024 }),
  maxEventsFileBytes: Object.freeze({ default: 16_777_216, maximum: 16_777_216, minimum: 1 }),
  maxRawResponseBytes: Object.freeze({ default: 1_048_576, maximum: 1_048_576, minimum: 65_536 }),
  maxStderrBytes: Object.freeze({ default: 8_388_608, maximum: 8_388_608, minimum: 65_536 }),
  maxStdoutBytes: Object.freeze({ default: 8_388_608, maximum: 8_388_608, minimum: 65_536 }),
  wallClockTimeoutMs: Object.freeze({ default: 1_800_000, maximum: 1_800_000, minimum: 1_000 }),
});

const maxTerminalEventBytes = 2_097_152;
const invocationForbiddenLimits = new Set<string>([
  'activeStateOperationTimeoutMs',
  'initializationTimeoutMs',
  'maxCompletedInvocations',
]);
const limitNames = new Set(Object.keys(limitPolicies));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const assertKnownLimits = (value: Record<string, unknown>): void => {
  if (Reflect.ownKeys(value).some((key) => typeof key !== 'string' || !limitNames.has(key)))
    throw new LimitValidationError('Invalid manager limit key.');
};

const boundedLimit = (value: unknown, policy: LimitPolicy, maximum: number): number => {
  if (value === undefined) return policy.default;
  if (!Number.isSafeInteger(value) || Number(value) < policy.minimum || Number(value) > maximum)
    throw new LimitValidationError('Invalid manager limit.');
  return Number(value);
};

const readLimit = (
  name: LimitName,
  value: Record<string, unknown>,
  defaults: LimitDefaults,
  capToDefaults: boolean,
): number => {
  const policy = limitPolicies[name];
  const configuredDefault = defaults[name] ?? policy.default;
  return boundedLimit(
    value[name],
    { ...policy, default: configuredDefault },
    capToDefaults ? configuredDefault : policy.maximum,
  );
};

const assertCoherentLimits = (limits: EffectiveLimits): void => {
  if (limits.idleTimeoutMs > limits.wallClockTimeoutMs)
    throw new LimitValidationError('Idle deadline exceeds wall deadline.');
  if (limits.activeStateOperationTimeoutMs > limits.initializationTimeoutMs)
    throw new LimitValidationError('Active-state deadline exceeds initialization deadline.');
  if (limits.maxEventsFileBytes < maxTerminalEventBytes + limits.maxEventBytes + 2)
    throw new LimitValidationError('Events file limit cannot reserve terminal events.');
};

const managerDefaults: LimitDefaults = Object.freeze({
  idleTimeoutMs: limitPolicies.idleTimeoutMs.default,
  wallClockTimeoutMs: limitPolicies.wallClockTimeoutMs.default,
});

const readLimits = (
  input: unknown,
  defaults: LimitDefaults = managerDefaults,
  capToDefaults = false,
): EffectiveLimits => {
  if (!isRecord(input)) throw new LimitValidationError('Invalid deadline limits.');
  assertKnownLimits(input);
  const limits = Object.freeze({
    activeStateOperationTimeoutMs: readLimit(
      'activeStateOperationTimeoutMs',
      input,
      defaults,
      capToDefaults,
    ),
    idleTimeoutMs: readLimit('idleTimeoutMs', input, defaults, capToDefaults),
    initializationTimeoutMs: readLimit('initializationTimeoutMs', input, defaults, capToDefaults),
    maxCompletedInvocations: readLimit('maxCompletedInvocations', input, defaults, capToDefaults),
    maxEventBytes: readLimit('maxEventBytes', input, defaults, capToDefaults),
    maxEventsFileBytes: readLimit('maxEventsFileBytes', input, defaults, capToDefaults),
    maxRawResponseBytes: readLimit('maxRawResponseBytes', input, defaults, capToDefaults),
    maxStderrBytes: readLimit('maxStderrBytes', input, defaults, capToDefaults),
    maxStdoutBytes: readLimit('maxStdoutBytes', input, defaults, capToDefaults),
    wallClockTimeoutMs: readLimit('wallClockTimeoutMs', input, defaults, capToDefaults),
  });
  assertCoherentLimits(limits);
  return limits;
};

export const managerLimits = (value: unknown): EffectiveLimits => readLimits(value ?? {});

export const invocationLimits = (value: unknown, defaults: LimitDefaults): EffectiveLimits => {
  try {
    if (
      isRecord(value) &&
      Reflect.ownKeys(value).some(
        (key) => typeof key === 'string' && invocationForbiddenLimits.has(key),
      )
    )
      throw new LimitValidationError('Invalid invocation limit key.');
    return readLimits(value ?? {}, defaults, true);
  } catch {
    throw new AgentManagerError(
      fault('revo.agent.limit_invalid', 'Agent invocation limit is invalid.', 'preflight'),
    );
  }
};
