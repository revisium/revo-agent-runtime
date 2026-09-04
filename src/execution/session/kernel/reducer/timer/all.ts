import type { SessionState } from '../../model/session-state.js';
import { appendEffect, nextEffectCorrelation, type SessionTransition } from '../transition.js';

export const clearAllTimers = <State extends SessionState>(
  transition: SessionTransition<State>,
): SessionTransition<State> => {
  let result: SessionTransition<State> = {
    effects: transition.effects,
    state: { ...transition.state, timers: [] },
  };
  for (const timer of transition.state.timers) {
    result = appendEffect(result, {
      correlation: nextEffectCorrelation(result.state),
      generation: timer.generation,
      timerId: timer.timerId,
      type: 'timer.cancel',
    });
  }
  return result;
};
