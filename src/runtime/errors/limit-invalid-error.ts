import type { AgentFault } from '../spec/index.js';
import { AgentManagerError } from './agent-manager-error.js';

export const limitInvalidError = (
  phase: AgentFault['phase'],
  operation: string,
  limit: number,
  message: string,
): AgentManagerError =>
  new AgentManagerError(
    Object.freeze({
      code: 'revo.agent.limit_invalid' as const,
      message,
      phase,
      retryable: false,
      details: Object.freeze({ operation, limit }),
    }),
  );
