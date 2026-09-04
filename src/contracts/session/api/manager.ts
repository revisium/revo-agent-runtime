import type { ActiveInvocationSnapshot } from '../../manager.js';
import type { AgentSessionAgentDescriptor } from '../capabilities/negotiated.js';
import type { AgentSessionEventSink } from '../events/sink.js';
import type {
  RespondAgentSessionRequest,
  RespondAgentSessionResult,
} from '../interaction/response.js';
import type { CancelAgentSessionResult } from '../lifecycle/result.js';
import type {
  AgentSessionFilter,
  AgentSessionSnapshot,
  AgentSessionTerminalFilter,
  AgentSessionTerminalRecord,
} from '../lifecycle/snapshot.js';
import type {
  ActiveAgentSessionSnapshot,
  ActiveAgentSessionStateSink,
} from '../persistence/active-state.js';
import type { AgentSessionLaunchContext, OpenAgentSession } from '../requests/open.js';
import type { ResumeAgentSession } from '../requests/resume.js';
import type { AgentSession } from './session.js';

export interface AgentSessionManagerLimits {
  readonly activeStateOperationTimeoutMs?: number;
  readonly recoveryTimeoutMs?: number;
  readonly maxActiveSessions?: number;
  readonly maxOpeningSessions?: number;
  readonly maxCompletedSessions?: number;
  readonly maxSessionIdentities?: number;
}

export interface AgentSessionManagerOptions {
  readonly activeStateSink: ActiveAgentSessionStateSink;
  readonly eventSink: AgentSessionEventSink;
  readonly limits?: AgentSessionManagerLimits;
}

export interface AgentManagerInitialization {
  readonly invocations: readonly ActiveInvocationSnapshot[];
  readonly sessions?: readonly ActiveAgentSessionSnapshot[];
}

export interface AgentSessions {
  listAgents(): readonly AgentSessionAgentDescriptor[];

  open(request: OpenAgentSession, context?: AgentSessionLaunchContext): Promise<AgentSession>;
  resume(request: ResumeAgentSession, context?: AgentSessionLaunchContext): Promise<AgentSession>;

  get(sessionId: string): AgentSession | undefined;
  inspect(sessionId: string): AgentSessionSnapshot | undefined;
  list(filter?: AgentSessionFilter): readonly AgentSessionSnapshot[];
  getTerminal(sessionId: string): AgentSessionTerminalRecord | undefined;
  listTerminal(filter?: AgentSessionTerminalFilter): readonly AgentSessionTerminalRecord[];

  respond(sessionId: string, input: RespondAgentSessionRequest): Promise<RespondAgentSessionResult>;
  cancel(sessionId: string, reason?: string): Promise<CancelAgentSessionResult>;
}
