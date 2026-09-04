import type { SessionTimerState } from '../../model/session-state.js';
import type { SessionState } from '../../model/session-state.js';
import { appendEffect, nextEffectCorrelation, type SessionTransition } from '../transition.js';

export const scheduleOpeningTimer = <State extends SessionState>(
  transition: SessionTransition<State>,
  timer: SessionTimerState,
): SessionTransition<State> => {
  const correlation = nextEffectCorrelation(transition.state);
  return appendEffect(
    {
      effects: transition.effects,
      state: { ...transition.state, timers: [...transition.state.timers, timer] },
    },
    { correlation, timer, type: 'timer.schedule' },
  );
};

export const cancelOpeningTimer = <State extends SessionState>(
  transition: SessionTransition<State>,
  timer: SessionTimerState,
): SessionTransition<State> => {
  const correlation = nextEffectCorrelation(transition.state);
  return appendEffect(transition, {
    correlation,
    generation: timer.generation,
    timerId: timer.timerId,
    type: 'timer.cancel',
  });
};
