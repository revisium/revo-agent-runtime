import { AgentManagerError, limitInvalidError } from '../../runtime/errors/index.js';
import { AGENT_FAULT_MESSAGES, AGENT_RUNTIME_LIMITS } from '../../runtime/policy/index.js';
import type { AgentFault } from '../../runtime/spec/index.js';
import { managerClosedError } from './manager-closed-error.js';
import { managerNotInitializedError } from './manager-not-initialized-error.js';
import type { StartRejection } from './start-rejection.js';

type TabledReason = Exclude<
  StartRejection['reason'],
  'launch_proof_failed' | 'manager_closed' | 'manager_not_initialized' | 'limit_invalid'
>;

const table = Object.freeze({
  invocation_invalid: {
    code: 'revo.agent.invocation_invalid',
    message: AGENT_FAULT_MESSAGES.invocationInvalid,
    phase: 'preflight',
    retryable: false,
  },
  invocation_duplicate: {
    code: 'revo.agent.invocation_duplicate',
    message: AGENT_FAULT_MESSAGES.invocationDuplicate,
    phase: 'preflight',
    retryable: false,
  },
  output_conflict: {
    code: 'revo.agent.output_conflict',
    message: AGENT_FAULT_MESSAGES.outputConflict,
    phase: 'preflight',
    retryable: false,
  },
  scratch_failed: {
    code: 'revo.agent.scratch_failed',
    message: AGENT_FAULT_MESSAGES.scratchFailed,
    phase: 'preflight',
    retryable: false,
  },
  environment_invalid: {
    code: 'revo.agent.environment_invalid',
    message: AGENT_FAULT_MESSAGES.environmentInvalid,
    phase: 'preflight',
    retryable: false,
  },
  process_identity_failed: {
    code: 'revo.agent.process_identity_failed',
    message: AGENT_FAULT_MESSAGES.processIdentityFailed,
    phase: 'starting',
    retryable: false,
  },
  active_state_failed: {
    code: 'revo.agent.active_state_failed',
    message: AGENT_FAULT_MESSAGES.activeStateFailed,
    phase: 'starting',
    retryable: false,
  },
  result_schema_invalid: {
    code: 'revo.agent.result_schema_invalid',
    message: AGENT_FAULT_MESSAGES.resultSchemaInvalid,
    phase: 'preflight',
    retryable: false,
  },
  spawn_failed: {
    code: 'revo.agent.spawn_failed',
    message: AGENT_FAULT_MESSAGES.spawnFailed,
    phase: 'preflight',
    retryable: false,
  },
  platform_unsupported: {
    code: 'revo.agent.platform_unsupported',
    message: AGENT_FAULT_MESSAGES.platformUnsupported,
    phase: 'preflight',
    retryable: false,
  },
  workspace_invalid: {
    code: 'revo.agent.workspace_invalid',
    message: AGENT_FAULT_MESSAGES.workspaceInvalid,
    phase: 'preflight',
    retryable: false,
  },
  output_path_invalid: {
    code: 'revo.agent.output_path_invalid',
    message: AGENT_FAULT_MESSAGES.outputPathInvalid,
    phase: 'preflight',
    retryable: false,
  },
  parameters_invalid: {
    code: 'revo.agent.parameters_invalid',
    message: AGENT_FAULT_MESSAGES.parametersInvalid,
    phase: 'preflight',
    retryable: false,
  },
  permissions_invalid: {
    code: 'revo.agent.permissions_invalid',
    message: AGENT_FAULT_MESSAGES.permissionsInvalid,
    phase: 'preflight',
    retryable: false,
  },
  strategy_unsupported: {
    code: 'revo.agent.strategy_unsupported',
    message: AGENT_FAULT_MESSAGES.strategyUnsupported,
    phase: 'preflight',
    retryable: false,
  },
  agent_unknown: {
    code: 'revo.agent.agent_unknown',
    message: AGENT_FAULT_MESSAGES.agentUnknown,
    phase: 'preflight',
    retryable: false,
  },
  internal: {
    code: 'revo.agent.internal',
    message: AGENT_FAULT_MESSAGES.internalStart,
    phase: 'preflight',
    retryable: false,
  },
} satisfies Readonly<Record<TabledReason, AgentFault>>);

export const startRejectionError = (rejection: StartRejection): AgentManagerError => {
  if (rejection.reason === 'launch_proof_failed') return new AgentManagerError(rejection.fault);
  if (rejection.reason === 'manager_closed') return managerClosedError();
  if (rejection.reason === 'manager_not_initialized') return managerNotInitializedError();
  if (rejection.reason === 'limit_invalid')
    return limitInvalidError(
      'preflight',
      'start',
      AGENT_RUNTIME_LIMITS.argvBytes,
      AGENT_FAULT_MESSAGES.limitInvalid,
    );
  return new AgentManagerError(Object.freeze({ ...table[rejection.reason] }));
};
