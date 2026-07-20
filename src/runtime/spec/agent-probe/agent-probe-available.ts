import type { AgentRef } from '../agent-definition/index.js';

export interface AgentProbeAvailable {
  readonly status: 'available';
  readonly agent: AgentRef;
  readonly definitionDigest: string;
  readonly executable: string;
  readonly reportedVersion?: string;
}
