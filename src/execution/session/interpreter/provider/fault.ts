import type { AgentFault } from '../../../../contracts/manager.js';
import type { SessionProtocolFailure } from '../../../../protocol/session/errors/protocol-error.js';

export const protocolFault = (
  failure: SessionProtocolFailure | undefined,
  phase: AgentFault['phase'],
): AgentFault => {
  let code: AgentFault['code'] = 'revo.agent.protocol_failed';
  if (failure?.code === 'configuration_stale') code = 'revo.agent.configuration_stale';
  if (failure?.code === 'configuration_value_unsupported')
    code = 'revo.agent.configuration_value_unsupported';
  if (failure?.code === 'capability_unsupported') code = 'revo.agent.session_unsupported';
  return {
    code,
    message: 'The provider session protocol operation failed.',
    phase,
    retryable: failure?.retryable ?? false,
  };
};
