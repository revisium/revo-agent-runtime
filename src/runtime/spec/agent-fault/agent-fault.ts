import type { JsonObject } from '../json/index.js';

export type AgentFaultCode =
  | 'revo.agent.definition_invalid'
  | 'revo.agent.definition_duplicate'
  | 'revo.agent.strategy_unsupported'
  | 'revo.agent.limit_invalid'
  | 'revo.agent.agent_unknown'
  | 'revo.agent.manager_closed'
  | 'revo.agent.shutdown_failed'
  | 'revo.agent.platform_unsupported'
  | 'revo.agent.probe_platform_unsupported'
  | 'revo.agent.probe_spawn_failed'
  | 'revo.agent.probe_timeout'
  | 'revo.agent.probe_output_too_large'
  | 'revo.agent.probe_process_failed'
  | 'revo.agent.probe_output_invalid'
  | 'revo.agent.probe_version_mismatch'
  | 'revo.agent.protocol_failed'
  | 'revo.agent.output_write_failed'
  | 'revo.agent.process_failed'
  | 'revo.agent.process_cleanup_failed'
  | 'revo.agent.result_missing'
  | 'revo.agent.result_too_large'
  | 'revo.agent.result_invalid_json'
  | 'revo.agent.result_not_object'
  | 'revo.agent.result_schema_mismatch'
  | 'revo.agent.scratch_cleanup_failed'
  | 'revo.agent.cancelled'
  | 'revo.agent.timeout'
  | 'revo.agent.internal';

export interface AgentFault {
  readonly code: AgentFaultCode;
  readonly message: string;
  readonly phase:
    | 'construction'
    | 'manager'
    | 'shutdown'
    | 'probing'
    | 'preflight'
    | 'execution'
    | 'running'
    | 'collecting_result'
    | 'finalizing';
  readonly retryable: boolean;
  readonly details?: JsonObject;
}
