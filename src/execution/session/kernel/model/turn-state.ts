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

interface SettlingTurnState extends ActiveTurnStateBase {
  readonly status: 'settling';
  readonly outcome: AgentSessionTurnOutcome;
}

interface CompletedTurnState extends TurnStateBase {
  readonly status: 'completed';
  readonly result: Extract<AgentSessionTurnResult, { readonly status: 'completed' }>;
}

type IncompleteTurnResult = Extract<
  AgentSessionTurnResult,
  { readonly status: 'cancelled' | 'timed_out' | 'interrupted' }
>;

interface CancelledTurnState extends TurnStateBase {
  readonly status: 'cancelled';
  readonly result: IncompleteTurnResult & { readonly status: 'cancelled' };
}

interface TimedOutTurnState extends TurnStateBase {
  readonly status: 'timed_out';
  readonly result: IncompleteTurnResult & { readonly status: 'timed_out' };
}

interface InterruptedTurnState extends TurnStateBase {
  readonly status: 'interrupted';
  readonly result: IncompleteTurnResult & { readonly status: 'interrupted' };
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
