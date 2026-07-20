import type { AgentFault } from '../spec/index.js';

export class AgentManagerError extends Error {
  constructor(readonly fault: AgentFault) {
    super(fault.message);
    this.name = 'AgentManagerError';
  }
}
