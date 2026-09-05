import { AgentManagerError, type AgentFault } from '../../../contracts/manager.js';

export const sessionManagerError = (
  code: AgentFault['code'],
  message: string,
  phase: AgentFault['phase'] = 'session_opening',
): AgentManagerError =>
  new AgentManagerError(Object.freeze({ code, message, phase, retryable: false }));
