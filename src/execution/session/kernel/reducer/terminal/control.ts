import type { PublicSessionCommand } from '../../command/public.js';
import type { TimerCommand } from '../../command/timer.js';
import type { SessionState, TerminalIntent } from '../../model/session-state.js';
import type { TerminalTurnState } from '../../model/turn-state.js';
import {
  appendEffect,
  nextEffectCorrelation,
  type SessionTransition,
  unchangedTransition,
} from '../transition.js';
import {
  beginTerminalResourceCleanup,
  clearSessionTimers,
  terminalizingState,
  timerFault,
  type ActiveSession,
  type TerminalizingSession,
} from './state.js';

type RunningSession = Extract<SessionState, { readonly status: 'running' }>;
type CancelSession = Extract<PublicSessionCommand, { readonly type: 'session.cancel' }>;

const resolveCancelSession = (
  transition: SessionTransition<TerminalizingSession>,
  command: CancelSession,
): SessionTransition<TerminalizingSession> => {
  const correlation = nextEffectCorrelation(transition.state);
  return appendEffect(transition, {
    callId: command.call.callId,
    correlation,
    resolution: { kind: 'cancel_session', result: { state: 'requested' } },
    type: 'public.resolve',
  });
};

export const settleRunningSession = (
  state: RunningSession,
  intent: Exclude<TerminalIntent, { readonly outcome: 'closed' }>,
): SessionTransition<TerminalizingSession> => {
  const turnOutcome =
    intent.outcome === 'timed_out'
      ? ({ status: 'timed_out' } as const)
      : intent.outcome === 'failed'
        ? ({ error: intent.error, status: 'failed' } as const)
        : ({ status: 'interrupted' } as const);
  if (state.turn.status === 'settling') {
    const turn =
      state.turn.progress.stage === 'awaiting_provider'
        ? {
            ...state.turn,
            progress: { ...state.turn.progress, outcome: turnOutcome },
          }
        : state.turn;
    return clearSessionTimers({
      effects: [],
      state: terminalizingState(state, intent, { stage: 'settling_turn', turn }),
    });
  }
  if (state.turn.status === 'starting')
    return clearSessionTimers({
      effects: [],
      state: terminalizingState(state, intent, { stage: 'settling_turn', turn: state.turn }),
    });
  const cancellationCorrelation = nextEffectCorrelation(state, state.turn.turnId);
  const turn = {
    ...state.turn,
    progress: {
      cancellationCorrelation,
      outcome: turnOutcome,
      stage: 'awaiting_provider' as const,
    },
    status: 'settling' as const,
  };
  const reason = 'reason' in intent ? intent.reason : undefined;
  return appendEffect(
    clearSessionTimers({
      effects: [],
      state: terminalizingState(state, intent, { stage: 'settling_turn', turn }),
    }),
    {
      correlation: cancellationCorrelation,
      ...(reason === undefined ? {} : { reason }),
      providerResourceId: state.providerResourceId,
      timeoutMs: state.limits.operationTimeoutMs,
      turnId: state.turn.turnId,
      type: 'provider.turn.cancel',
    },
  );
};

export const cancelRunningSession = (
  state: RunningSession,
  command: CancelSession,
): SessionTransition => {
  const intent = {
    ...(command.reason === undefined ? {} : { reason: command.reason }),
    outcome: 'cancelled' as const,
  };
  return resolveCancelSession(settleRunningSession(state, intent), command);
};

const failedTurn = (
  state: RunningSession,
  intent: Extract<TerminalIntent, { readonly outcome: 'failed' }>,
): TerminalTurnState => {
  const turn = state.turn;
  if (turn.status === 'starting')
    return { ...turn, result: { error: intent.error, status: 'failed' }, status: 'failed' };
  if (turn.status === 'settling') {
    const {
      correlation: _correlation,
      message: _message,
      progress: _progress,
      status: _status,
      usage: _usage,
      ...base
    } = turn;
    return { ...base, result: { error: intent.error, status: 'failed' }, status: 'failed' };
  }
  const {
    correlation: _correlation,
    message: _message,
    status: _status,
    usage: _usage,
    ...base
  } = turn;
  return { ...base, result: { error: intent.error, status: 'failed' }, status: 'failed' };
};

export const failActiveSession = (
  state: ActiveSession,
  error: Extract<TerminalIntent, { readonly outcome: 'failed' }>['error'],
): SessionTransition => {
  const intent = { error, outcome: 'failed' as const };
  const terminal = terminalizingState(state, intent, {
    correlation: nextEffectCorrelation(state),
    stage: 'closing_provider',
  });
  let transition = beginTerminalResourceCleanup(
    clearSessionTimers({ effects: [], state: terminal }),
  );
  if (state.status !== 'running') return transition;
  transition = {
    effects: transition.effects,
    state: { ...transition.state, lastTurn: failedTurn(state, intent) },
  };
  const correlation = nextEffectCorrelation(transition.state, state.turn.turnId);
  transition = appendEffect(transition, {
    callId: state.turn.resultCallId,
    correlation,
    resolution: { kind: 'turn_result', result: { error, status: 'failed' } },
    type: 'public.resolve',
  });
  if (state.turn.status !== 'starting') return transition;
  const handleCorrelation = nextEffectCorrelation(transition.state, state.turn.turnId);
  return appendEffect(transition, {
    callId: state.turn.handleCallId,
    correlation: handleCorrelation,
    fault: error,
    type: 'public.reject',
  });
};

export const reduceTimer = (state: ActiveSession, command: TimerCommand): SessionTransition => {
  const timer = state.timers.find(({ timerId }) => timerId === command.timerId);
  if (
    timer === undefined ||
    timer.generation !== command.generation ||
    timer.kind !== command.kind ||
    (timer.kind !== 'idle' && timer.kind !== 'wall_clock')
  )
    return unchangedTransition(state);
  const intent = {
    error: timerFault(timer.kind),
    outcome: 'timed_out' as const,
    timeout: timer.kind === 'idle' ? ('idle_timeout' as const) : ('wall_clock_timeout' as const),
  };
  if (state.status === 'running') return settleRunningSession(state, intent);
  const terminal = terminalizingState(state, intent, {
    correlation: nextEffectCorrelation(state),
    stage: 'closing_provider',
  });
  return beginTerminalResourceCleanup(clearSessionTimers({ effects: [], state: terminal }));
};
