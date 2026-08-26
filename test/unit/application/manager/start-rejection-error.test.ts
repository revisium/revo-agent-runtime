import { expect, test } from 'vitest';

import { startRejectionError } from '../../../../src/application/manager/start-rejection-error.js';
import {
  AGENT_FAULT_MESSAGES,
  AGENT_RUNTIME_LIMITS,
} from '../../../../src/runtime/policy/index.js';

const rows = [
  [
    'invocation_invalid',
    'revo.agent.invocation_invalid',
    AGENT_FAULT_MESSAGES.invocationInvalid,
    'preflight',
  ],
  [
    'invocation_duplicate',
    'revo.agent.invocation_duplicate',
    AGENT_FAULT_MESSAGES.invocationDuplicate,
    'preflight',
  ],
  [
    'output_conflict',
    'revo.agent.output_conflict',
    AGENT_FAULT_MESSAGES.outputConflict,
    'preflight',
  ],
  ['scratch_failed', 'revo.agent.scratch_failed', AGENT_FAULT_MESSAGES.scratchFailed, 'preflight'],
  [
    'environment_invalid',
    'revo.agent.environment_invalid',
    AGENT_FAULT_MESSAGES.environmentInvalid,
    'preflight',
  ],
  [
    'manager_not_initialized',
    'revo.agent.manager_not_initialized',
    AGENT_FAULT_MESSAGES.managerNotInitialized,
    'initializing',
  ],
  ['manager_closed', 'revo.agent.manager_closed', AGENT_FAULT_MESSAGES.managerClosed, 'manager'],
  [
    'process_identity_failed',
    'revo.agent.process_identity_failed',
    AGENT_FAULT_MESSAGES.processIdentityFailed,
    'starting',
  ],
  [
    'active_state_failed',
    'revo.agent.active_state_failed',
    AGENT_FAULT_MESSAGES.activeStateFailed,
    'starting',
  ],
  [
    'result_schema_invalid',
    'revo.agent.result_schema_invalid',
    AGENT_FAULT_MESSAGES.resultSchemaInvalid,
    'preflight',
  ],
  ['spawn_failed', 'revo.agent.spawn_failed', AGENT_FAULT_MESSAGES.spawnFailed, 'preflight'],
  ['limit_invalid', 'revo.agent.limit_invalid', AGENT_FAULT_MESSAGES.limitInvalid, 'preflight'],
  [
    'platform_unsupported',
    'revo.agent.platform_unsupported',
    AGENT_FAULT_MESSAGES.platformUnsupported,
    'preflight',
  ],
  [
    'workspace_invalid',
    'revo.agent.workspace_invalid',
    AGENT_FAULT_MESSAGES.workspaceInvalid,
    'preflight',
  ],
  [
    'output_path_invalid',
    'revo.agent.output_path_invalid',
    AGENT_FAULT_MESSAGES.outputPathInvalid,
    'preflight',
  ],
  [
    'parameters_invalid',
    'revo.agent.parameters_invalid',
    AGENT_FAULT_MESSAGES.parametersInvalid,
    'preflight',
  ],
  [
    'permissions_invalid',
    'revo.agent.permissions_invalid',
    AGENT_FAULT_MESSAGES.permissionsInvalid,
    'preflight',
  ],
  [
    'strategy_unsupported',
    'revo.agent.strategy_unsupported',
    AGENT_FAULT_MESSAGES.strategyUnsupported,
    'preflight',
  ],
  ['agent_unknown', 'revo.agent.agent_unknown', AGENT_FAULT_MESSAGES.agentUnknown, 'preflight'],
  ['internal', 'revo.agent.internal', AGENT_FAULT_MESSAGES.internalStart, 'preflight'],
] as const;

test.each(rows)('%s maps to its stable manager fault', (reason, code, message, phase) => {
  const error = startRejectionError({ status: 'rejected', reason });
  expect(error.fault).toEqual({
    code,
    message,
    phase,
    retryable: false,
    ...(reason === 'limit_invalid'
      ? { details: { operation: 'start', limit: AGENT_RUNTIME_LIMITS.argvBytes } }
      : {}),
  });
});

test('passes a retryable launch-proof fault through by identity', () => {
  const fault = Object.freeze({
    code: 'revo.agent.probe_timeout' as const,
    message: AGENT_FAULT_MESSAGES.probeTimeout,
    phase: 'probing' as const,
    retryable: true,
  });
  const error = startRejectionError({ status: 'rejected', reason: 'launch_proof_failed', fault });
  expect(error.fault).toBe(fault);
  expect(error.fault.retryable).toBe(true);
});
