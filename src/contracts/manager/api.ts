import type { AgentRef } from '../agent-definition.js';
import type { AgentConfigurationCatalog, InspectAgentConfiguration } from '../configuration.js';
import type { AgentManagerInitialization, AgentSessions } from '../session/api/manager.js';
import type { ActiveInvocationSnapshot, AgentDescriptor } from './core.js';
import type { AgentEventFilter, AgentEventListener, Unsubscribe } from './events.js';
import type {
  AgentInvocationFilter,
  AgentInvocationHandle,
  AgentInvocationResult,
  AgentInvocationSnapshot,
  AgentProbeResult,
  AgentResultLookup,
  AgentStartContext,
  CancelInvocationResult,
  StartAgentInvocation,
} from './invocation.js';

export interface AgentManager {
  readonly sessions: AgentSessions;
  listAgents(): readonly AgentDescriptor[];
  getAgent(agent: AgentRef): AgentDescriptor | undefined;
  inspectConfiguration(
    request: InspectAgentConfiguration,
    context?: AgentStartContext,
  ): Promise<AgentConfigurationCatalog>;
  initialize(
    snapshots: readonly ActiveInvocationSnapshot[] | AgentManagerInitialization,
  ): Promise<void>;
  subscribe(filter: AgentEventFilter, listener: AgentEventListener): Unsubscribe;
  start(request: StartAgentInvocation, context?: AgentStartContext): Promise<AgentInvocationHandle>;
  listInvocations(filter?: AgentInvocationFilter): readonly AgentInvocationSnapshot[];
  getInvocation(invocationId: string): AgentInvocationSnapshot | undefined;
  getResult(invocationId: string): AgentResultLookup;
  waitForResult(invocationId: string): Promise<AgentInvocationResult>;
  probeAgent(agent: AgentRef): Promise<AgentProbeResult>;
  cancel(invocationId: string, reason?: string): Promise<CancelInvocationResult>;
  shutdown(reason?: string): Promise<void>;
}
