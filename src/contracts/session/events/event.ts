import type { AgentFault, AgentExecutionPin } from '../../manager.js';
import type { AgentSessionCapabilities } from '../capabilities/negotiated.js';
import type {
  AgentSessionInteractionScope,
  AgentSessionInteractiveRequest,
} from '../interaction/request.js';
import type { AgentSessionInteractiveResponse } from '../interaction/response.js';
import type { AgentSessionTurnOutcome, AgentSessionUsage } from '../lifecycle/result.js';

export interface AgentSessionEventBase {
  readonly schemaVersion: 'agent-session-event/v1';
  readonly sessionId: string;
  readonly streamId: string;
  readonly sequence: number;
  readonly eventId: string;
  readonly observedAt: string;
}

export interface AgentSessionEventCursor {
  readonly streamId: string;
  readonly sequence: number;
  readonly eventId: string;
}

export type SessionAcceptedEvent = AgentSessionEventBase & {
  readonly type: 'session.accepted';
  readonly pin: AgentExecutionPin;
} & (
    | { readonly resumed: false }
    | {
        readonly resumed: true;
        readonly resumeTokenId: string;
        readonly resumeTokenSha256: string;
      }
  );

export interface SessionOpenedEvent extends AgentSessionEventBase {
  readonly type: 'session.opened';
  readonly pin: AgentExecutionPin;
  readonly capabilities: AgentSessionCapabilities;
  readonly resumed: boolean;
}

export interface TurnStartedEvent extends AgentSessionEventBase {
  readonly type: 'turn.started';
  readonly turnId: string;
  readonly metadata?: Readonly<import('../../agent-definition.js').JsonObject>;
}

export interface AssistantMessageDeltaEvent extends AgentSessionEventBase {
  readonly type: 'assistant.message.delta';
  readonly turnId: string;
  readonly content: string;
}

export interface AssistantMessageCompletedEvent extends AgentSessionEventBase {
  readonly type: 'assistant.message.completed';
  readonly turnId: string;
  readonly role: 'assistant';
  readonly contentBytes: number;
  readonly contentSha256: string;
}

export interface AgentProgressEvent extends AgentSessionEventBase {
  readonly type: 'agent.progress';
  readonly turnId: string;
  readonly message: string;
}

export interface ToolActivityEvent extends AgentSessionEventBase {
  readonly type: 'tool.activity';
  readonly turnId: string;
  readonly toolCallId: string;
  readonly kind: 'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'fetch' | 'other';
  readonly title: string;
  readonly status: 'started' | 'in_progress' | 'completed' | 'failed';
}

export interface AgentSessionPlanItem {
  readonly itemId: string;
  readonly title: string;
  readonly status: 'pending' | 'in_progress' | 'completed';
}

export interface PlanUpdatedEvent extends AgentSessionEventBase {
  readonly type: 'plan.updated';
  readonly turnId: string;
  readonly items: readonly AgentSessionPlanItem[];
}

export interface InteractionRequestedEvent extends AgentSessionEventBase {
  readonly type: 'interaction.requested';
  readonly scope: AgentSessionInteractionScope;
  readonly request: AgentSessionInteractiveRequest;
}

export interface InteractionResolvedEvent extends AgentSessionEventBase {
  readonly type: 'interaction.resolved';
  readonly scope: AgentSessionInteractionScope;
  readonly requestId: string;
  readonly response: AgentSessionInteractiveResponse;
}

export interface UsageUpdatedEvent extends AgentSessionEventBase {
  readonly type: 'usage.updated';
  readonly turnId: string;
  readonly usage: AgentSessionUsage;
}

export interface SessionCheckpointedEvent extends AgentSessionEventBase {
  readonly type: 'session.checkpointed';
  readonly checkpointId: string;
  readonly checkpointSha256: string;
}

export interface TurnCompletedEvent extends AgentSessionEventBase {
  readonly type: 'turn.completed';
  readonly turnId: string;
  readonly outcome: AgentSessionTurnOutcome;
}

export interface SessionHibernatedEvent extends AgentSessionEventBase {
  readonly type: 'session.hibernated';
  readonly resumeTokenId: string;
  readonly resumeTokenSha256: string;
}

export type SessionClosedEvent = AgentSessionEventBase & { readonly type: 'session.closed' } & (
    | { readonly outcome: 'closed' | 'cancelled' }
    | {
        readonly outcome: 'idle_timeout' | 'wall_clock_timeout' | 'failed';
        readonly error: AgentFault;
      }
  );

export type AgentSessionEvent =
  | SessionAcceptedEvent
  | SessionOpenedEvent
  | TurnStartedEvent
  | AssistantMessageDeltaEvent
  | AssistantMessageCompletedEvent
  | AgentProgressEvent
  | ToolActivityEvent
  | PlanUpdatedEvent
  | InteractionRequestedEvent
  | InteractionResolvedEvent
  | UsageUpdatedEvent
  | SessionCheckpointedEvent
  | TurnCompletedEvent
  | SessionHibernatedEvent
  | SessionClosedEvent;
