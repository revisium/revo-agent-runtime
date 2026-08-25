import { AgentManagerError } from '../../runtime/errors/index.js';
import { AGENT_FAULT_MESSAGES } from '../../runtime/policy/index.js';

export const managerClosedError = (): AgentManagerError =>
  new AgentManagerError(
    Object.freeze({
      code: 'revo.agent.manager_closed' as const,
      message: AGENT_FAULT_MESSAGES.managerClosed,
      phase: 'manager' as const,
      retryable: false,
    }),
  );
