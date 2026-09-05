import type { TurnCompletedEvent } from '../../../../../contracts/session/events/event.js';
import type { SessionCommand } from '../../command/session-command.js';
import type { SessionState } from '../../model/session-state.js';
import { clearSessionTimers, terminalizingState } from '../terminal/state.js';
import { resetInactivity } from '../timer/inactivity.js';
import {
  appendEffect,
  nextEffectCorrelation,
  nextSessionEventId,
  queueSessionEvent,
  type SessionTransition,
  unchangedTransition,
} from '../transition.js';
import { projectTurnResult, terminalTurn } from './result.js';

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
  turn: Exclude<RunningState['turn'], { readonly status: 'starting' }>,
  command: PromptOutcome,
  outcome: TurnCompletedEvent['outcome'],
): SessionTransition<RunningState> => {
  const usage = outcome.status === 'completed' ? (outcome.usage ?? state.usage) : state.usage;
  return queueSessionEvent(
    {
      ...state,
      turn: {
        ...turn,
        progress: { outcome, stage: 'publishing_completion' },
        status: 'settling',
        usage,
      },
      usage,
    },
    completedEvent(state, command, outcome),
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
    if (matchesCancellation && command.type !== 'provider.prompt.completed') {
      const published = publishTurnCompletion(state, state.turn, command, {
        error: command.fault,
        status: 'failed',
      });
      return clearSessionTimers({
        effects: published.effects,
        state: terminalizingState(
          published.state,
          { error: command.fault, outcome: 'failed' },
          {
            stage: 'settling_turn',
            turn: published.state.turn,
          },
        ),
      });
    }
    return resetInactivity(
      publishTurnCompletion(state, state.turn, command, cancellation.outcome),
      command.observedAtMs,
    );
  }
  if (state.turn.status === 'starting' || !matchesPrompt(state, command))
    return unchangedTransition(state);
  if (command.type === 'provider.prompt.accepted')
    return resetInactivity(
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
  return resetInactivity(
    publishTurnCompletion(state, state.turn, command, outcome),
    command.observedAtMs,
  );
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
