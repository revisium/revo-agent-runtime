import { AgentManagerError, type AgentFault } from '../../../contracts/manager/core.js';

export const sessionManagerError = (
  code: AgentFault['code'],
  message: string,
  phase: AgentFault['phase'] = 'session_opening',
): AgentManagerError =>
  new AgentManagerError(Object.freeze({ code, message, phase, retryable: false }));
