import type {
  AgentDefinition,
  AgentDefinitionInput,
  AgentRef,
  JsonObject,
} from '../agent-definition.js';
export type { AgentLaunchEvidence } from '../launch.js';

export interface AgentDescriptor {
  readonly agent: AgentRef;
  readonly definitionDigest: string;
  readonly displayName: string;
  readonly description?: string;
  readonly capabilities: AgentDefinition['capabilities'];
}

export interface AgentExecutionPin {
  readonly agentId: string;
  readonly agentVersion: string;
  readonly definitionDigest: string;
}

export interface ActiveProcessIdentity {
  readonly pid: number;
  readonly processGroupId: number;
  readonly fingerprint: string;
  readonly startedAt: string;
}

export interface ActiveInvocationSnapshot {
  readonly invocationId: string;
  readonly pin: AgentExecutionPin;
  readonly state: 'running' | 'cancelling';
  readonly process: ActiveProcessIdentity;
}

export interface ActiveInvocationStateSink {
  save(
    snapshot: ActiveInvocationSnapshot,
    context: { readonly signal: AbortSignal },
  ): Promise<void>;
  remove(invocationId: string, context: { readonly signal: AbortSignal }): Promise<void>;
}

export interface AgentManagerOptions {
  readonly definitions: readonly AgentDefinitionInput[];
  readonly activeStateSink: ActiveInvocationStateSink;
  readonly limits?: AgentManagerLimits;
  readonly redaction?: { readonly secrets: readonly string[] };
}

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

export interface AgentFault {
  readonly code:
    | 'revo.agent.agent_unknown'
    | 'revo.agent.definition_duplicate'
    | 'revo.agent.definition_invalid'
    | 'revo.agent.internal'
    | 'revo.agent.invocation_duplicate'
    | 'revo.agent.invocation_unknown'
    | 'revo.agent.parameters_invalid'
    | 'revo.agent.permissions_invalid'
    | 'revo.agent.workspace_invalid'
    | 'revo.agent.output_path_invalid'
    | 'revo.agent.output_conflict'
    | 'revo.agent.platform_unsupported'
    | 'revo.agent.probe_platform_unsupported'
    | 'revo.agent.probe_spawn_failed'
    | 'revo.agent.probe_timeout'
    | 'revo.agent.probe_output_too_large'
    | 'revo.agent.probe_process_failed'
    | 'revo.agent.probe_output_invalid'
    | 'revo.agent.manager_closed'
    | 'revo.agent.manager_not_initialized'
    | 'revo.agent.limit_invalid'
    | 'revo.agent.cancelled'
    | 'revo.agent.configuration_stale'
    | 'revo.agent.configuration_value_unsupported'
    | 'revo.agent.timeout'
    | 'revo.agent.process_cleanup_failed'
    | 'revo.agent.shutdown_failed'
    | 'revo.agent.protocol_failed'
    | 'revo.agent.output_write_failed'
    | 'revo.agent.active_state_failed'
    | 'revo.agent.result_missing'
    | 'revo.agent.result_too_large'
    | 'revo.agent.result_invalid_json'
    | 'revo.agent.result_not_object'
    | 'revo.agent.result_schema_mismatch'
    | 'revo.agent.strategy_unsupported';
  readonly message: string;
  readonly details?: JsonObject;
  readonly phase:
    | 'construction'
    | 'execution'
    | 'manager'
    | 'probing'
    | 'preflight'
    | 'running'
    | 'shutdown'
    | 'collecting_result'
    | 'finalizing';
  readonly retryable: boolean;
}

export class AgentManagerError extends Error {
  constructor(readonly fault: AgentFault) {
    super(fault.message);
    this.name = 'AgentManagerError';
  }
}
