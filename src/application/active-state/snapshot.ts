import type { ActiveInvocationSnapshot, AgentExecutionPin } from '../../contracts/manager.js';
import type { ProcessIdentity } from '../../execution/process/port.js';

export const activeInvocationSnapshot = (
  invocationId: string,
  pin: AgentExecutionPin,
  state: ActiveInvocationSnapshot['state'],
  process: ProcessIdentity,
): ActiveInvocationSnapshot =>
  Object.freeze({
    invocationId,
    pin,
    process: Object.freeze({ ...process }),
    state,
  });
