interface LimitPolicy {
  readonly default: number;
  readonly minimum: number;
  readonly maximum: number;
}

export const agentSessionManagerLimitPolicies = Object.freeze({
  activeStateOperationTimeoutMs: Object.freeze({ default: 5_000, minimum: 100, maximum: 60_000 }),
  recoveryTimeoutMs: Object.freeze({ default: 30_000, minimum: 1_000, maximum: 300_000 }),
  maxActiveSessions: Object.freeze({ default: 32, minimum: 1, maximum: 256 }),
  maxOpeningSessions: Object.freeze({ default: 4, minimum: 1, maximum: 32 }),
  maxCompletedSessions: Object.freeze({ default: 1_000, minimum: 1, maximum: 10_000 }),
  maxSessionIdentities: Object.freeze({ default: 10_000, minimum: 32, maximum: 100_000 }),
}) satisfies Readonly<Record<string, LimitPolicy>>;

export const agentSessionLimitPolicies = Object.freeze({
  openingTimeoutMs: Object.freeze({ default: 60_000, minimum: 1_000, maximum: 600_000 }),
  idleTimeoutMs: Object.freeze({ default: 900_000, minimum: 1_000, maximum: 86_400_000 }),
  wallClockTimeoutMs: Object.freeze({ default: 14_400_000, minimum: 1_000, maximum: 604_800_000 }),
  operationTimeoutMs: Object.freeze({ default: 30_000, minimum: 100, maximum: 300_000 }),
  eventSinkTimeoutMs: Object.freeze({ default: 10_000, minimum: 100, maximum: 300_000 }),
  maxEventBytes: Object.freeze({ default: 65_536, minimum: 1_024, maximum: 1_048_576 }),
  maxMessageBytes: Object.freeze({ default: 4_194_304, minimum: 1_024, maximum: 16_777_216 }),
  maxPromptBytes: Object.freeze({ default: 1_048_576, minimum: 1, maximum: 4_194_304 }),
  maxMetadataBytes: Object.freeze({ default: 65_536, minimum: 2, maximum: 262_144 }),
  maxInteractionBytes: Object.freeze({ default: 262_144, minimum: 1_024, maximum: 1_048_576 }),
  maxCheckpointBytes: Object.freeze({ default: 1_048_576, minimum: 1_024, maximum: 4_194_304 }),
  maxOutputBytes: Object.freeze({ default: 16_777_216, minimum: 1_024, maximum: 67_108_864 }),
  maxPendingInteractions: Object.freeze({ default: 8, minimum: 1, maximum: 32 }),
}) satisfies Readonly<Record<string, LimitPolicy>>;
