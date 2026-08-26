import { AgentManagerError } from '../../runtime/errors/index.js';
import { AGENT_FAULT_MESSAGES } from '../../runtime/policy/index.js';

export const managerNotInitializedError = (): AgentManagerError =>
  new AgentManagerError(
    Object.freeze({
      code: 'revo.agent.manager_not_initialized' as const,
      message: AGENT_FAULT_MESSAGES.managerNotInitialized,
      phase: 'initializing' as const,
      retryable: false,
    }),
  );
