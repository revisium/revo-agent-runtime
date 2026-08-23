import type { AgentRef } from '../agent-definition/index.js';
import type { AgentInvocationStatus } from './agent-invocation-status.js';

export interface AgentInvocationFilter {
  readonly invocationId?: string;
  readonly agent?: AgentRef;
  readonly statuses?: readonly AgentInvocationStatus[];
}
