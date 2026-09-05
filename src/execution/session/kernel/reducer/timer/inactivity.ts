import type { SessionState } from '../../model/session-state.js';
import { appendEffect, nextEffectCorrelation, type SessionTransition } from '../transition.js';

export const pauseInactivity = <State extends SessionState>(
  transition: SessionTransition<State>,
): SessionTransition<State> => {
  const timer = transition.state.timers.find(({ kind }) => kind === 'idle');
  if (timer === undefined) return transition;
  const state = {
    ...transition.state,
    idleTimerGeneration: Math.max(transition.state.idleTimerGeneration, timer.generation),
    timers: transition.state.timers.filter(({ kind }) => kind !== 'idle'),
  };
  return appendEffect(
    { effects: transition.effects, state },
    {
      correlation: nextEffectCorrelation(state),
      generation: timer.generation,
      timerId: timer.timerId,
      type: 'timer.cancel',
    },
  );
};

export const resetInactivity = <State extends SessionState>(
  transition: SessionTransition<State>,
  observedAtMs: number,
): SessionTransition<State> => {
  const paused = pauseInactivity(transition);
  const generation = paused.state.idleTimerGeneration + 1;
  const timer = {
    deadlineMs: observedAtMs + paused.state.limits.idleTimeoutMs,
    generation,
    kind: 'idle',
    timerId: `${paused.state.sessionId}:${paused.state.epoch}:idle`,
  } as const;
  const state = {
    ...paused.state,
    idleTimerGeneration: generation,
    timers: [...paused.state.timers, timer],
  };
  return appendEffect(
    { effects: paused.effects, state },
    {
      correlation: nextEffectCorrelation(state),
      timer,
      type: 'timer.schedule',
    },
  );
};
