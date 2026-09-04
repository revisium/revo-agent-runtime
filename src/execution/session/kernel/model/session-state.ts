import type { JsonObject } from '../../../../contracts/agent-definition.js';
import type {
  ActiveProcessIdentity,
  AgentExecutionPin,
  AgentFault,
} from '../../../../contracts/manager/core.js';
import type { AgentSessionCapabilities } from '../../../../contracts/session/capabilities/negotiated.js';
import type {
  AgentSessionEvent,
  AgentSessionEventCursor,
} from '../../../../contracts/session/events/event.js';
import type {
  AgentSessionCheckpoint,
  AgentSessionResumeToken,
} from '../../../../contracts/session/lifecycle/checkpoint.js';
import type {
  AgentSessionOutputPublication,
  AgentSessionUsage,
} from '../../../../contracts/session/lifecycle/result.js';
import type {
  AgentSessionLimits,
  OpenAgentSession,
} from '../../../../contracts/session/requests/open.js';
import type { ResumeAgentSession } from '../../../../contracts/session/requests/resume.js';
import type { EffectCorrelation } from './identity.js';
import type { InteractionState } from './interaction-state.js';
import type { ActiveTurnState, TerminalTurnState } from './turn-state.js';

interface SessionLaunchEnvironment {
  readonly inherit: readonly string[];
  readonly variables: Readonly<Record<string, string>>;
  readonly secrets: Readonly<Record<string, string>>;
}

interface ProviderContinuation {
  readonly format: string;
  readonly data: Readonly<JsonObject>;
}

export type SessionOpeningRequest =
  | { readonly kind: 'fresh'; readonly request: OpenAgentSession }
  | {
      readonly kind: 'resume';
      readonly request: ResumeAgentSession;
      readonly continuation: ProviderContinuation;
    };

export interface SessionOpeningDescriptor {
  readonly incarnationId: string;
  readonly pin: AgentExecutionPin;
  readonly request: SessionOpeningRequest;
  readonly environment?: SessionLaunchEnvironment;
  readonly limits: Required<AgentSessionLimits>;
  readonly usageBaseline: AgentSessionUsage;
  readonly acceptedAt: string;
  readonly streamId: string;
}

interface SessionEventDelivery {
  readonly cursor?: AgentSessionEventCursor;
  readonly pending: readonly AgentSessionEvent[];
  readonly inFlight?: {
    readonly event: AgentSessionEvent;
    readonly correlation: EffectCorrelation;
  };
}

export interface SessionTimerState {
  readonly timerId: string;
  readonly kind: 'opening' | 'wall_clock' | 'idle' | 'operation' | 'event_sink';
  readonly generation: number;
  readonly deadlineMs: number;
}

interface SessionStateBase {
  readonly sessionId: string;
  readonly epoch: number;
  readonly incarnationId: string;
  readonly pin: AgentExecutionPin;
  readonly limits: Required<AgentSessionLimits>;
  readonly acceptedAt: string;
  readonly streamId: string;
  readonly outputDirectory: string;
  readonly metadata?: Readonly<JsonObject>;
  readonly usage: AgentSessionUsage;
  readonly nextEffectSequence: number;
  readonly nextEventSequence: number;
  readonly events: SessionEventDelivery;
  readonly interactions: readonly InteractionState[];
  readonly timers: readonly SessionTimerState[];
}

export type OpeningProgress =
  | { readonly stage: 'publishing_accepted'; readonly opening: SessionOpeningDescriptor }
  | {
      readonly stage: 'preparing';
      readonly opening: SessionOpeningDescriptor;
      readonly correlation: EffectCorrelation;
    }
  | {
      readonly stage: 'starting_process';
      readonly preparationId: string;
      readonly correlation: EffectCorrelation;
    }
  | {
      readonly stage: 'saving_process';
      readonly preparationId: string;
      readonly processResourceId: string;
      readonly process: ActiveProcessIdentity;
      readonly correlation: EffectCorrelation;
    }
  | {
      readonly stage: 'opening_provider';
      readonly preparationId: string;
      readonly processResourceId: string;
      readonly process: ActiveProcessIdentity;
      readonly correlation: EffectCorrelation;
    }
  | {
      readonly stage: 'publishing_opened';
      readonly processResourceId: string;
      readonly process: ActiveProcessIdentity;
      readonly providerResourceId: string;
      readonly capabilities: AgentSessionCapabilities;
    };

interface OpeningSessionState extends SessionStateBase {
  readonly status: 'opening';
  readonly progress: OpeningProgress;
}

interface ActiveSessionStateBase extends SessionStateBase {
  readonly providerResourceId: string;
  readonly processResourceId: string;
  readonly process: ActiveProcessIdentity;
  readonly capabilities: AgentSessionCapabilities;
  readonly openedAt: string;
  readonly lastTurn?: TerminalTurnState;
}

interface IdleSessionState extends ActiveSessionStateBase {
  readonly status: 'idle';
}

interface RunningSessionState extends ActiveSessionStateBase {
  readonly status: 'running';
  readonly turn: ActiveTurnState;
}

export type CheckpointProgress =
  | { readonly stage: 'capturing'; readonly correlation: EffectCorrelation }
  | { readonly stage: 'publishing'; readonly checkpoint: AgentSessionCheckpoint };

interface CheckpointingSessionState extends ActiveSessionStateBase {
  readonly status: 'checkpointing';
  readonly callId: string;
  readonly checkpointId: string;
  readonly progress: CheckpointProgress;
}

export type HibernationProgress =
  | { readonly stage: 'capturing'; readonly correlation: EffectCorrelation }
  | { readonly stage: 'publishing'; readonly resumeToken: AgentSessionResumeToken }
  | {
      readonly stage:
        | 'closing_provider'
        | 'cleaning_process'
        | 'removing_state'
        | 'publishing_output';
      readonly resumeToken: AgentSessionResumeToken;
      readonly correlation: EffectCorrelation;
    };

interface HibernatingSessionState extends ActiveSessionStateBase {
  readonly status: 'hibernating';
  readonly callId: string;
  readonly resumeTokenId: string;
  readonly reason?: string;
  readonly progress: HibernationProgress;
}

type TerminalIntent =
  | { readonly outcome: 'closed'; readonly reason?: string }
  | { readonly outcome: 'cancelled'; readonly reason?: string }
  | { readonly outcome: 'timed_out'; readonly error: AgentFault }
  | { readonly outcome: 'failed'; readonly error: AgentFault };

export type TerminalProgress =
  | { readonly stage: 'settling_turn' }
  | { readonly stage: 'closing_provider'; readonly correlation: EffectCorrelation }
  | { readonly stage: 'cleaning_process'; readonly correlation: EffectCorrelation }
  | { readonly stage: 'removing_state'; readonly correlation: EffectCorrelation }
  | { readonly stage: 'publishing_event' }
  | { readonly stage: 'publishing_output'; readonly correlation: EffectCorrelation };

interface ClosingSessionState extends ActiveSessionStateBase {
  readonly status: 'closing';
  readonly callIds: readonly string[];
  readonly intent: TerminalIntent;
  readonly progress: TerminalProgress;
}

interface CancellingSessionState extends ActiveSessionStateBase {
  readonly status: 'cancelling';
  readonly callIds: readonly string[];
  readonly intent: Exclude<TerminalIntent, { readonly outcome: 'closed' }>;
  readonly progress: TerminalProgress;
}

interface TerminalSessionStateBase extends SessionStateBase {
  readonly finishedAt: string;
  readonly output?: AgentSessionOutputPublication;
}

type ConfirmedTerminalSessionState = TerminalSessionStateBase &
  (
    | { readonly status: 'hibernated'; readonly resumeToken: AgentSessionResumeToken }
    | { readonly status: 'closed' }
    | { readonly status: 'cancelled' }
    | { readonly status: 'timed_out'; readonly error: AgentFault }
    | { readonly status: 'failed'; readonly error: AgentFault }
  );

interface CleanupUncertainSessionState extends SessionStateBase {
  readonly status: 'cleanup_uncertain';
  readonly error: AgentFault;
  readonly processResourceId?: string;
  readonly process?: ActiveProcessIdentity;
}

export type SessionState =
  | OpeningSessionState
  | IdleSessionState
  | RunningSessionState
  | CheckpointingSessionState
  | HibernatingSessionState
  | ClosingSessionState
  | CancellingSessionState
  | ConfirmedTerminalSessionState
  | CleanupUncertainSessionState;
