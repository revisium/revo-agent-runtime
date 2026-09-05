import type { AgentFault } from '../../../../contracts/manager.js';
import type { SessionProtocolFailure } from '../../../../protocol/session/errors/protocol-error.js';

export const protocolFault = (
  failure: SessionProtocolFailure | undefined,
  phase: AgentFault['phase'],
): AgentFault => {
  const code =
    failure?.code === 'configuration_stale'
      ? 'revo.agent.configuration_stale'
      : failure?.code === 'configuration_value_unsupported'
        ? 'revo.agent.configuration_value_unsupported'
        : failure?.code === 'capability_unsupported'
          ? 'revo.agent.session_unsupported'
          : 'revo.agent.protocol_failed';
  return {
    code,
    message: 'The provider session protocol operation failed.',
    phase,
    retryable: failure?.retryable ?? false,
  };
};
