import type { TurnCompletedEvent } from '../../../../../contracts/session/events/event.js';
import type { AgentSessionTurnResult } from '../../../../../contracts/session/lifecycle/result.js';
import type { SessionCommand } from '../../command/session-command.js';
import type { SessionState } from '../../model/session-state.js';
import type { TerminalTurnState } from '../../model/turn-state.js';
import {
  appendEffect,
  nextEffectCorrelation,
  nextSessionEventId,
  queueSessionEvent,
  type SessionTransition,
  unchangedTransition,
} from '../transition.js';
import { resetTurnInactivity } from './timing.js';

type RunningState = Extract<SessionState, { readonly status: 'running' }>;
type PromptOutcome = Extract<SessionCommand, { readonly type: `provider.prompt.${string}` }>;

const matchesPrompt = (state: RunningState, command: PromptOutcome): boolean =>
  'correlation' in state.turn &&
  state.turn.correlation.effectId === command.correlation.effectId &&
  state.turn.turnId === command.correlation.turnId;

const completedEvent = (
  state: RunningState,
  command: PromptOutcome,
  outcome: TurnCompletedEvent['outcome'],
): TurnCompletedEvent => ({
  eventId: nextSessionEventId(state),
  observedAt: command.observedAt,
  outcome,
  schemaVersion: 'agent-session-event/v1',
  sequence: state.nextEventSequence,
  sessionId: state.sessionId,
  streamId: state.streamId,
  turnId: state.turn.turnId,
  type: 'turn.completed',
});

const publishTurnCompletion = (
  state: RunningState,
  command: PromptOutcome,
  outcome: TurnCompletedEvent['outcome'],
): SessionTransition => {
  if (state.turn.status === 'starting') return unchangedTransition(state);
  const usage = outcome.status === 'completed' ? (outcome.usage ?? state.usage) : state.usage;
  return resetTurnInactivity(
    queueSessionEvent(
      {
        ...state,
        turn: {
          ...state.turn,
          progress: { outcome, stage: 'publishing_completion' },
          status: 'settling',
          usage,
        },
        usage,
      },
      completedEvent(state, command, outcome),
    ),
    command.observedAtMs,
  );
};

export const reducePromptOutcome = (
  state: RunningState,
  command: PromptOutcome,
): SessionTransition => {
  if (state.turn.status === 'settling') {
    if (state.turn.progress.stage !== 'awaiting_provider') return unchangedTransition(state);
    const cancellation = state.turn.progress;
    const matchesCancellation =
      cancellation.cancellationCorrelation.effectId === command.correlation.effectId;
    if (!matchesPrompt(state, command) && !matchesCancellation) return unchangedTransition(state);
    if (command.type === 'provider.prompt.accepted') return unchangedTransition(state);
    const outcome =
      matchesCancellation && command.type !== 'provider.prompt.completed'
        ? ({ error: command.fault, status: 'failed' } as const)
        : cancellation.outcome;
    return publishTurnCompletion(state, command, outcome);
  }
  if (state.turn.status === 'starting' || !matchesPrompt(state, command))
    return unchangedTransition(state);
  if (command.type === 'provider.prompt.accepted')
    return resetTurnInactivity(
      {
        effects: [],
        state: { ...state, turn: { ...state.turn, status: 'streaming' } },
      },
      command.observedAtMs,
    );
  const outcome =
    command.type === 'provider.prompt.completed'
      ? command.outcome
      : ({ error: command.fault, status: 'failed' } as const);
  return publishTurnCompletion(state, command, outcome);
};

export const projectTurnResult = (
  turn: Extract<RunningState['turn'], { readonly status: 'settling' }>,
): AgentSessionTurnResult => {
  if (turn.progress.stage !== 'publishing_completion')
    throw new Error('Cannot project an unsettled turn result.');
  if (turn.progress.outcome.status === 'completed')
    return {
      message: turn.message,
      status: 'completed',
      ...(turn.usage === undefined ? {} : { usage: turn.usage }),
    };
  if (turn.progress.outcome.status === 'failed') return turn.progress.outcome;
  return { status: turn.progress.outcome.status };
};

const terminalTurn = (
  turn: Extract<RunningState['turn'], { readonly status: 'settling' }>,
  result: AgentSessionTurnResult,
): TerminalTurnState => {
  const {
    correlation: _correlation,
    message: _message,
    progress: _progress,
    status: _status,
    usage: _usage,
    ...base
  } = turn;
  switch (result.status) {
    case 'completed':
      return { ...base, result, status: 'completed' };
    case 'failed':
      return { ...base, result, status: 'failed' };
    case 'cancelled':
      return { ...base, result: { status: 'cancelled' }, status: 'cancelled' };
    case 'interrupted':
      return { ...base, result: { status: 'interrupted' }, status: 'interrupted' };
    case 'timed_out':
      return { ...base, result: { status: 'timed_out' }, status: 'timed_out' };
  }
  throw new Error('Unsupported terminal turn result.');
};

export const finishTurn = (
  state: RunningState,
  transition: SessionTransition,
): SessionTransition => {
  if (
    state.turn.status !== 'settling' ||
    state.turn.progress.stage !== 'publishing_completion' ||
    transition.state.status !== 'running'
  )
    return transition;
  const result = projectTurnResult(state.turn);
  const finishedTurn = terminalTurn(state.turn, result);
  const { turn: _turn, ...baseState } = transition.state;
  let finished: SessionTransition = {
    effects: transition.effects,
    state: { ...baseState, lastTurn: finishedTurn, status: 'idle' },
  };
  const correlation = nextEffectCorrelation(finished.state, state.turn.turnId);
  finished = appendEffect(finished, {
    callId: state.turn.resultCallId,
    correlation,
    resolution: { kind: 'turn_result', result },
    type: 'public.resolve',
  });
  return finished;
};
