import type { AgentRef, AgentDescriptor } from '../agent-definition/index.js';
import type { AgentEventFilter, AgentEventListener, Unsubscribe } from '../agent-event/index.js';
import type { AgentInvocationResult } from '../agent-invocation-result/index.js';
import type {
  AgentInvocationFilter,
  AgentInvocationHandle,
  AgentInvocationSnapshot,
  AgentStartContext,
  StartAgentInvocation,
} from '../agent-invocation/index.js';
import type { CancelInvocationResult, AgentResultLookup } from '../agent-invocation/index.js';
import type { AgentProbeResult } from '../agent-probe/index.js';
import type { ActiveInvocationSnapshot } from '../manager-options/index.js';

export interface AgentManager {
  listAgents(): readonly AgentDescriptor[];
  getAgent(agent: AgentRef): AgentDescriptor | undefined;
  initialize(snapshots: readonly ActiveInvocationSnapshot[]): Promise<void>;
  probeAgent(agent: AgentRef): Promise<AgentProbeResult>;

  subscribe(filter: AgentEventFilter, listener: AgentEventListener): Unsubscribe;

  start(request: StartAgentInvocation, context?: AgentStartContext): Promise<AgentInvocationHandle>;
  listInvocations(filter?: AgentInvocationFilter): readonly AgentInvocationSnapshot[];
  getInvocation(invocationId: string): AgentInvocationSnapshot | undefined;
  getResult(invocationId: string): AgentResultLookup;
  waitForResult(invocationId: string): Promise<AgentInvocationResult>;
  cancel(invocationId: string, reason?: string): Promise<CancelInvocationResult>;
  shutdown(reason?: string): Promise<void>;
}
