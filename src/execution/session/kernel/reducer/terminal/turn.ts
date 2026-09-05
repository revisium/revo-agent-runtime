import type { TurnCompletedEvent } from '../../../../../contracts/session/events/event.js';
import type { SessionCommand } from '../../command/session-command.js';
import type { TerminalTurnState } from '../../model/turn-state.js';
import {
  acknowledgeSessionEvent,
  appendEffect,
  nextEffectCorrelation,
  nextSessionEventId,
  queueSessionEvent,
  type SessionTransition,
  unchangedTransition,
} from '../transition.js';
import { projectTurnResult } from '../turn/completion.js';
import { beginProviderPrompt } from '../turn/start.js';
import { settleRunningSession } from './control.js';
import { beginTerminalResourceCleanup, type TerminalizingSession } from './state.js';

type PromptOutcome = Extract<SessionCommand, { readonly type: `provider.prompt.${string}` }>;
type EventOutcome = Extract<SessionCommand, { readonly type: `event.${string}` }>;

const publishCompletion = (
  state: TerminalizingSession,
  progress: Extract<TerminalizingSession['progress'], { readonly stage: 'settling_turn' }>,
  command: PromptOutcome,
): SessionTransition => {
  const turn = progress.turn;
  if (turn.status !== 'settling' || turn.progress.stage !== 'awaiting_provider')
    return unchangedTransition(state);
  const matchesPrompt = turn.correlation.effectId === command.correlation.effectId;
  const matchesCancel =
    turn.progress.cancellationCorrelation.effectId === command.correlation.effectId;
  if ((!matchesPrompt && !matchesCancel) || command.type === 'provider.prompt.accepted')
    return unchangedTransition(state);
  const outcome =
    matchesCancel && command.type !== 'provider.prompt.completed'
      ? ({ error: command.fault, status: 'failed' } as const)
      : turn.progress.outcome;
  const event: TurnCompletedEvent = {
    eventId: nextSessionEventId(state),
    observedAt: command.observedAt,
    outcome,
    schemaVersion: 'agent-session-event/v1',
    sequence: state.nextEventSequence,
    sessionId: state.sessionId,
    streamId: state.streamId,
    turnId: turn.turnId,
    type: 'turn.completed',
  };
  return queueSessionEvent(
    {
      ...state,
      progress: {
        stage: 'settling_turn',
        turn: {
          ...turn,
          progress: { outcome, stage: 'publishing_completion' },
        },
      },
    },
    event,
  );
};

const terminalTurn = (
  turn: Extract<
    Extract<TerminalizingSession['progress'], { readonly stage: 'settling_turn' }>['turn'],
    { readonly status: 'settling' }
  >,
): TerminalTurnState => {
  const result = projectTurnResult(turn);
  const {
    correlation: _correlation,
    message: _message,
    progress: _progress,
    status: _status,
    usage: _usage,
    ...base
  } = turn;
  if (result.status === 'completed') return { ...base, result, status: 'completed' };
  if (result.status === 'failed') return { ...base, result, status: 'failed' };
  if (result.status === 'cancelled')
    return { ...base, result: { status: 'cancelled' }, status: 'cancelled' };
  if (result.status === 'timed_out')
    return { ...base, result: { status: 'timed_out' }, status: 'timed_out' };
  return { ...base, result: { status: 'interrupted' }, status: 'interrupted' };
};

const reduceTerminalTurnEvent = (
  state: TerminalizingSession,
  command: EventOutcome,
): SessionTransition => {
  if (
    state.progress.stage !== 'settling_turn' ||
    (command.type !== 'event.applied' && command.type !== 'event.timed_out_then_applied') ||
    command.result.state !== 'appended'
  )
    return unchangedTransition(state);
  const acknowledged = acknowledgeSessionEvent(state, command.correlation);
  if (acknowledged === undefined) return unchangedTransition(state);
  const turn = state.progress.turn;
  if (acknowledged.event.type === 'turn.started' && turn.status === 'starting') {
    const {
      callIds: _calls,
      intent,
      progress: _progress,
      status: _status,
      ...active
    } = acknowledged.transition.state;
    const running = { ...active, status: 'running' as const, turn };
    const prompted = beginProviderPrompt(running, {
      effects: acknowledged.transition.effects,
      state: running,
    });
    if (intent.outcome === 'closed') return acknowledged.transition;
    const settled = settleRunningSession(prompted.state, intent);
    return { effects: [...prompted.effects, ...settled.effects], state: settled.state };
  }
  if (
    acknowledged.event.type !== 'turn.completed' ||
    turn.status !== 'settling' ||
    turn.progress.stage !== 'publishing_completion'
  )
    return acknowledged.transition;
  const result = projectTurnResult(turn);
  let transition: SessionTransition<TerminalizingSession> = appendEffect(
    {
      effects: acknowledged.transition.effects,
      state: {
        ...acknowledged.transition.state,
        lastTurn: terminalTurn(turn),
        progress: { correlation: nextEffectCorrelation(state), stage: 'closing_provider' },
      },
    },
    {
      callId: turn.resultCallId,
      correlation: nextEffectCorrelation(acknowledged.transition.state, turn.turnId),
      resolution: { kind: 'turn_result', result },
      type: 'public.resolve',
    },
  );
  const reason = 'reason' in state.intent ? state.intent.reason : undefined;
  transition = beginTerminalResourceCleanup(transition, reason);
  return transition;
};

export const reduceTerminalTurn = (
  state: TerminalizingSession,
  command: SessionCommand,
): SessionTransition | undefined => {
  if (state.progress.stage !== 'settling_turn') return undefined;
  if (
    command.type === 'provider.prompt.accepted' ||
    command.type === 'provider.prompt.completed' ||
    command.type === 'provider.prompt.failed' ||
    command.type === 'provider.prompt.rejected' ||
    command.type === 'provider.prompt.timed_out'
  )
    return publishCompletion(state, state.progress, command);
  if (
    command.type === 'event.applied' ||
    command.type === 'event.failed' ||
    command.type === 'event.timed_out_then_applied' ||
    command.type === 'event.timed_out_then_failed' ||
    command.type === 'event.unknown'
  )
    return reduceTerminalTurnEvent(state, command);
  return unchangedTransition(state);
};
