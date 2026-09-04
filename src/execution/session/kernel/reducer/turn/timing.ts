import { appendEffect, nextEffectCorrelation, type SessionTransition } from '../transition.js';

export const resetTurnInactivity = (
  transition: SessionTransition,
  observedAtMs: number,
): SessionTransition => {
  const current = transition.state.timers.find(({ kind }) => kind === 'idle');
  let result: SessionTransition = {
    effects: transition.effects,
    state: {
      ...transition.state,
      timers: transition.state.timers.filter(({ kind }) => kind !== 'idle'),
    },
  };
  if (current !== undefined) {
    const correlation = nextEffectCorrelation(result.state);
    result = appendEffect(result, {
      correlation,
      generation: current.generation,
      timerId: current.timerId,
      type: 'timer.cancel',
    });
  }
  const timer = {
    deadlineMs: observedAtMs + result.state.limits.idleTimeoutMs,
    generation: (current?.generation ?? 0) + 1,
    kind: 'idle',
    timerId: `${result.state.sessionId}:${result.state.epoch}:idle`,
  } as const;
  const correlation = nextEffectCorrelation(result.state);
  return appendEffect(
    {
      effects: result.effects,
      state: { ...result.state, timers: [...result.state.timers, timer] },
    },
    { correlation, timer, type: 'timer.schedule' },
  );
};
