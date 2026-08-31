import { AgentManagerError, type AgentFault } from '../../contracts/manager.js';
import type { ExecutionOutcome } from '../../execution/invocation/executor.js';
import type { OutputClaimRejection } from '../../execution/output/claim.js';
import type { ExecutablePreflightFailure } from '../../execution/probe/executable-preflight.js';

export const fault = (
  code: AgentFault['code'],
  message: string,
  phase: AgentFault['phase'],
): AgentFault => Object.freeze({ code, message, phase, retryable: false });

export const managerError = (code: AgentFault['code'], message: string): AgentManagerError =>
  new AgentManagerError(fault(code, message, 'manager'));

export const protocolFailure = (): AgentFault =>
  fault(
    'revo.agent.protocol_failed',
    'The agent protocol did not produce a valid terminal result.',
    'execution',
  );

type CollectingResultFaultCode =
  | 'revo.agent.result_missing'
  | 'revo.agent.result_too_large'
  | 'revo.agent.result_invalid_json'
  | 'revo.agent.result_not_object'
  | 'revo.agent.result_schema_mismatch';

const isCollectingResultFault = (
  code: AgentFault['code'] | undefined,
): code is CollectingResultFaultCode =>
  code === 'revo.agent.result_missing' ||
  code === 'revo.agent.result_too_large' ||
  code === 'revo.agent.result_invalid_json' ||
  code === 'revo.agent.result_not_object' ||
  code === 'revo.agent.result_schema_mismatch';

const collectingResultMessages: Readonly<Record<CollectingResultFaultCode, string>> = Object.freeze(
  {
    'revo.agent.result_invalid_json': 'The agent result is not valid UTF-8 JSON.',
    'revo.agent.result_missing': 'The agent did not produce a terminal result.',
    'revo.agent.result_not_object': 'The agent result is not a top-level object.',
    'revo.agent.result_schema_mismatch': 'The agent result does not satisfy the requested schema.',
    'revo.agent.result_too_large': 'The agent result exceeded its byte limit.',
  },
);

export const executionFailure = (code: AgentFault['code'] | undefined): AgentFault => {
  if (code === 'revo.agent.configuration_stale')
    return fault(code, 'The selected agent configuration changed after inspection.', 'execution');
  if (code === 'revo.agent.configuration_value_unsupported')
    return fault(code, 'The selected agent configuration value is unavailable.', 'execution');
  if (code === 'revo.agent.output_write_failed')
    return fault(code, 'The agent output could not be finalized.', 'finalizing');
  if (isCollectingResultFault(code))
    return fault(code, collectingResultMessages[code], 'collecting_result');
  return protocolFailure();
};

export const cancellationFailure = (): AgentFault =>
  fault('revo.agent.cancelled', 'The agent invocation was cancelled.', 'running');

export const timeoutFailure = (): AgentFault =>
  fault('revo.agent.timeout', 'The agent invocation exceeded its deadline.', 'running');

export const activeStateError = (phase: 'manager' | 'preflight' | 'shutdown'): AgentManagerError =>
  new AgentManagerError(
    fault('revo.agent.active_state_failed', 'Agent active state could not be saved.', phase),
  );

export const preacceptanceError = (
  outcome: ExecutionOutcome,
  cleanup: 'confirmed' | 'uncertain',
): AgentManagerError => {
  if (cleanup === 'uncertain')
    return new AgentManagerError(
      fault(
        'revo.agent.process_cleanup_failed',
        'Agent process cleanup could not be confirmed.',
        'execution',
      ),
    );
  if (outcome.status === 'cancelled') return new AgentManagerError(cancellationFailure());
  if (outcome.status === 'timed_out') return new AgentManagerError(timeoutFailure());
  return new AgentManagerError(protocolFailure());
};

const outputFaultCode = (reason: OutputClaimRejection): AgentFault['code'] => {
  if (reason === 'workspace_invalid') return 'revo.agent.workspace_invalid';
  if (reason === 'output_path_invalid') return 'revo.agent.output_path_invalid';
  return 'revo.agent.output_conflict';
};

export const outputPreflightError = (reason: OutputClaimRejection): AgentManagerError =>
  new AgentManagerError(
    fault(
      outputFaultCode(reason),
      'Agent output directory is invalid or unavailable.',
      'preflight',
    ),
  );

const executableFaultCodes = Object.freeze({
  executable_not_found: 'revo.agent.probe_spawn_failed',
  executable_not_launchable: 'revo.agent.probe_spawn_failed',
  platform_unsupported: 'revo.agent.platform_unsupported',
  probe_cleanup_failed: 'revo.agent.probe_spawn_failed',
  probe_output_invalid: 'revo.agent.probe_output_invalid',
  probe_output_too_large: 'revo.agent.probe_output_too_large',
  probe_process_failed: 'revo.agent.probe_process_failed',
  probe_spawn_failed: 'revo.agent.probe_spawn_failed',
  probe_timeout: 'revo.agent.probe_timeout',
}) satisfies Readonly<Record<ExecutablePreflightFailure['reason'], AgentFault['code']>>;

const executableFaultCode = (reason: ExecutablePreflightFailure['reason']): AgentFault['code'] =>
  executableFaultCodes[reason];

export const executablePreflightError = (
  reason: ExecutablePreflightFailure['reason'],
): AgentManagerError =>
  new AgentManagerError(
    fault(executableFaultCode(reason), 'Agent executable preflight failed.', 'preflight'),
  );

const probingFault = (code: AgentFault['code'], message: string, retryable: boolean): AgentFault =>
  Object.freeze({ code, message, phase: 'probing', retryable });

export const unknownAgentProbeError = (): AgentManagerError =>
  new AgentManagerError(
    probingFault('revo.agent.agent_unknown', 'The requested agent is not registered.', false),
  );

export const internalProbeError = (): AgentManagerError =>
  new AgentManagerError(
    probingFault('revo.agent.internal', 'Agent executable probing could not be confirmed.', false),
  );

const unavailableExecutableFault = probingFault(
  'revo.agent.probe_spawn_failed',
  'Agent executable is unavailable.',
  false,
);

const unavailableProbeFaults = Object.freeze({
  executable_not_found: unavailableExecutableFault,
  executable_not_launchable: unavailableExecutableFault,
  platform_unsupported: probingFault(
    'revo.agent.probe_platform_unsupported',
    'Agent probing is not supported on this platform.',
    false,
  ),
  probe_cleanup_failed: undefined,
  probe_output_invalid: probingFault(
    'revo.agent.probe_output_invalid',
    'Agent version probe output is invalid.',
    false,
  ),
  probe_output_too_large: probingFault(
    'revo.agent.probe_output_too_large',
    'Agent version probe output exceeded its limit.',
    false,
  ),
  probe_process_failed: probingFault(
    'revo.agent.probe_process_failed',
    'Agent version probe exited unsuccessfully.',
    false,
  ),
  probe_spawn_failed: probingFault(
    'revo.agent.probe_spawn_failed',
    'Agent version probe could not start.',
    true,
  ),
  probe_timeout: probingFault('revo.agent.probe_timeout', 'Agent version probe timed out.', true),
}) satisfies Readonly<Record<ExecutablePreflightFailure['reason'], AgentFault | undefined>>;

export const unavailableProbeFault = (
  reason: ExecutablePreflightFailure['reason'],
): AgentFault | undefined => unavailableProbeFaults[reason];
