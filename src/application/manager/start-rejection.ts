import type { AgentFault } from '../../runtime/spec/index.js';

type SimpleStartRejectionReason =
  | 'invocation_invalid'
  | 'invocation_duplicate'
  | 'output_conflict'
  | 'scratch_failed'
  | 'environment_invalid'
  | 'manager_not_initialized'
  | 'manager_closed'
  | 'process_identity_failed'
  | 'active_state_failed'
  | 'result_schema_invalid'
  | 'spawn_failed'
  | 'limit_invalid'
  | 'platform_unsupported'
  | 'workspace_invalid'
  | 'output_path_invalid'
  | 'parameters_invalid'
  | 'permissions_invalid'
  | 'strategy_unsupported'
  | 'agent_unknown'
  | 'internal';

export type StartRejection =
  | Readonly<{ status: 'rejected'; reason: SimpleStartRejectionReason }>
  | Readonly<{ status: 'rejected'; reason: 'launch_proof_failed'; fault: AgentFault }>;
