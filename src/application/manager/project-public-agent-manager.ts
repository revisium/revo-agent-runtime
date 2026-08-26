import type { AgentManager } from '../../runtime/spec/agent-manager/index.js';
import type {
  ActiveInvocationSnapshot,
  AgentEventFilter,
  AgentEventListener,
  AgentInvocationFilter,
  AgentInvocationResult,
  AgentInvocationSnapshot,
  AgentProbeResult,
  AgentRef,
  AgentStartContext,
  AgentDescriptor,
  AgentResultLookup,
  CancelInvocationResult,
  StartAgentInvocation,
  Unsubscribe,
} from '../../runtime/spec/index.js';
import { createInvocationLifecycleManager } from './lifecycle-manager.js';
import { startRejectionError } from './start-rejection-error.js';

type InternalManager = ReturnType<typeof createInvocationLifecycleManager>;

export const projectPublicAgentManager = (internal: InternalManager): AgentManager =>
  Object.freeze({
    listAgents: (): readonly AgentDescriptor[] => internal.listAgents(),
    getAgent: (agent: AgentRef): AgentDescriptor | undefined => internal.getAgent(agent),
    initialize: (snapshots: readonly ActiveInvocationSnapshot[]): Promise<void> =>
      internal.initialize(snapshots),
    probeAgent: (agent: AgentRef): Promise<AgentProbeResult> => internal.probeAgent(agent),
    subscribe: (filter: AgentEventFilter, listener: AgentEventListener): Unsubscribe =>
      internal.subscribe(filter, listener),
    start: async (request: StartAgentInvocation, context?: AgentStartContext) => {
      const outcome = await internal.start(request, context);
      if (outcome.status === 'rejected') throw startRejectionError(outcome);
      return outcome.handle;
    },
    listInvocations: (filter?: AgentInvocationFilter): readonly AgentInvocationSnapshot[] =>
      internal.listInvocations(filter),
    getInvocation: (invocationId: string): AgentInvocationSnapshot | undefined =>
      internal.getInvocation(invocationId),
    getResult: (invocationId: string): AgentResultLookup => internal.getResult(invocationId),
    waitForResult: (invocationId: string): Promise<AgentInvocationResult> =>
      internal.waitForResult(invocationId),
    cancel: (invocationId: string, reason?: string): Promise<CancelInvocationResult> =>
      internal.cancel(invocationId, reason),
    shutdown: (reason?: string): Promise<void> => internal.shutdown(reason),
  });
