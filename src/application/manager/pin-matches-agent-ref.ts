import type { AgentExecutionPin, AgentRef } from '../../runtime/spec/index.js';

export const pinMatchesAgentRef = (pin: AgentExecutionPin, ref: AgentRef): boolean =>
  pin.agentId === ref.id && pin.agentVersion === ref.version;
