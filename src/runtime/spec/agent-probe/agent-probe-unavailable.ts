import type { AgentRef } from '../agent-definition/index.js';
import type { AgentFault } from '../agent-fault/index.js';

export interface AgentProbeUnavailable {
  readonly status: 'unavailable';
  readonly agent: AgentRef;
  readonly definitionDigest: string;
  readonly error: AgentFault;
}
