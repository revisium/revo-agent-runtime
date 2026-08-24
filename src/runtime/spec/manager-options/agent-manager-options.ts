import type { AgentDefinitionInput } from '../agent-definition/index.js';
import type { ActiveInvocationStateSink } from './active-invocation-state-sink.js';

export interface AgentManagerLimits {
  readonly activeStateOperationTimeoutMs?: number;
  readonly initializationTimeoutMs?: number;
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
  readonly activeStateSink: ActiveInvocationStateSink;
  readonly limits?: AgentManagerLimits;
  readonly redaction?: { readonly secrets: readonly string[] };
}
