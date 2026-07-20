export type AgentFaultCode =
  | 'revo.agent.definition_invalid'
  | 'revo.agent.definition_duplicate'
  | 'revo.agent.strategy_unsupported'
  | 'revo.agent.limit_invalid'
  | 'revo.agent.agent_unknown'
  | 'revo.agent.probe_platform_unsupported'
  | 'revo.agent.probe_spawn_failed'
  | 'revo.agent.probe_timeout'
  | 'revo.agent.probe_output_too_large'
  | 'revo.agent.probe_process_failed'
  | 'revo.agent.probe_output_invalid'
  | 'revo.agent.probe_version_mismatch'
  | 'revo.agent.internal';
