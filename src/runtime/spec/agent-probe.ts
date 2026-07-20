import type { AgentRef } from './agent-definition.js';
import type { AgentFault } from './agent-fault.js';

export interface AgentProbeAvailable {
  readonly status: 'available';
  readonly agent: AgentRef;
  readonly definitionDigest: string;
  readonly executable: string;
  readonly reportedVersion?: string;
}

export interface AgentProbeUnavailable {
  readonly status: 'unavailable';
  readonly agent: AgentRef;
  readonly definitionDigest: string;
  readonly error: AgentFault;
}

export type AgentProbeResult = AgentProbeAvailable | AgentProbeUnavailable;
