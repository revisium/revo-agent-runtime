import type { AgentDefinitionInput } from './agent-definition.js';

export interface AgentManagerLimits {
  readonly wallClockTimeoutMs?: number;
  readonly idleTimeoutMs?: number;
  readonly maxEventBytes?: number;
  readonly maxEventsFileBytes?: number;
  readonly maxStdoutBytes?: number;
  readonly maxStderrBytes?: number;
  readonly maxRawResponseBytes?: number;
  readonly maxCompletedInvocations?: number;
}

export interface AgentManagerOptions {
  readonly definitions: readonly AgentDefinitionInput[];
  readonly limits?: AgentManagerLimits;
  readonly redaction?: { readonly secrets: readonly string[] };
}

export const M1_MANAGER_LIMITS = Object.freeze({
  wallClockTimeoutMs: { minimum: 1_000, default: 1_800_000, maximum: 1_800_000 },
  idleTimeoutMs: { minimum: 1_000, default: 300_000, maximum: 300_000 },
  maxEventBytes: { minimum: 1_024, default: 65_536, maximum: 65_536 },
  maxEventsFileBytes: { default: 16_777_216, maximum: 16_777_216 },
  maxStdoutBytes: { minimum: 65_536, default: 8_388_608, maximum: 8_388_608 },
  maxStderrBytes: { minimum: 65_536, default: 8_388_608, maximum: 8_388_608 },
  maxRawResponseBytes: { minimum: 65_536, default: 1_048_576, maximum: 1_048_576 },
  maxCompletedInvocations: { minimum: 1, default: 1_000, maximum: 1_000 },
  maxTerminalEventBytes: 2_097_152,
} as const);
