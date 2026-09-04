import type { JsonObject } from '../../../../contracts/agent-definition.js';
import type {
  AgentSessionMessage,
  AgentSessionTurnOutcome,
  AgentSessionTurnResult,
  AgentSessionUsage,
} from '../../../../contracts/session/lifecycle/result.js';
import type { TurnEffectCorrelation } from './identity.js';

interface TurnStateBase {
  readonly turnId: string;
  readonly handleCallId: string;
  readonly resultCallId: string;
  readonly prompt: string;
  readonly metadata?: Readonly<JsonObject>;
}

interface StartingTurnState extends TurnStateBase {
  readonly status: 'starting';
}

interface ActiveTurnStateBase extends TurnStateBase {
  readonly message: AgentSessionMessage;
  readonly usage?: AgentSessionUsage;
}

interface PromptingTurnState extends ActiveTurnStateBase {
  readonly status: 'prompting';
  readonly correlation: TurnEffectCorrelation;
}

interface StreamingTurnState extends ActiveTurnStateBase {
  readonly status: 'streaming';
  readonly correlation: TurnEffectCorrelation;
}

interface AwaitingInteractionTurnState extends ActiveTurnStateBase {
  readonly status: 'awaiting_interaction';
  readonly correlation: TurnEffectCorrelation;
}

type SettlingTurnProgress =
  | {
      readonly stage: 'awaiting_provider';
      readonly cancellationCorrelation: TurnEffectCorrelation;
      readonly outcome: AgentSessionTurnOutcome;
    }
  | { readonly stage: 'publishing_completion'; readonly outcome: AgentSessionTurnOutcome };

interface SettlingTurnState extends ActiveTurnStateBase {
  readonly status: 'settling';
  readonly correlation: TurnEffectCorrelation;
  readonly progress: SettlingTurnProgress;
}

interface CompletedTurnState extends TurnStateBase {
  readonly status: 'completed';
  readonly result: Extract<AgentSessionTurnResult, { readonly status: 'completed' }>;
}

interface CancelledTurnState extends TurnStateBase {
  readonly status: 'cancelled';
  readonly result: { readonly status: 'cancelled' };
}

interface TimedOutTurnState extends TurnStateBase {
  readonly status: 'timed_out';
  readonly result: { readonly status: 'timed_out' };
}

interface InterruptedTurnState extends TurnStateBase {
  readonly status: 'interrupted';
  readonly result: { readonly status: 'interrupted' };
}

interface FailedTurnState extends TurnStateBase {
  readonly status: 'failed';
  readonly result: Extract<AgentSessionTurnResult, { readonly status: 'failed' }>;
}

export type ActiveTurnState =
  | StartingTurnState
  | PromptingTurnState
  | StreamingTurnState
  | AwaitingInteractionTurnState
  | SettlingTurnState;

export type TerminalTurnState =
  | CompletedTurnState
  | CancelledTurnState
  | TimedOutTurnState
  | InterruptedTurnState
  | FailedTurnState;

export type TurnState = ActiveTurnState | TerminalTurnState;
