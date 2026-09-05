import type { EffectOutcomeCommand } from '../../command/effect.js';
import { appendEffect, nextEffectCorrelation, type SessionTransition } from '../transition.js';

export const cleanupUnownedProcess = (
  transition: SessionTransition,
  command: Extract<EffectOutcomeCommand, { readonly type: 'process.started' }>,
): SessionTransition => {
  const state = transition.state;
  if ('processResourceId' in state && state.processResourceId === command.processResourceId)
    return transition;
  if (
    state.status === 'opening' &&
    'processResourceId' in state.progress &&
    state.progress.processResourceId === command.processResourceId
  )
    return transition;
  return appendEffect(transition, {
    type: 'process.cleanup',
    correlation: nextEffectCorrelation(state),
    process: command.process,
    processResourceId: command.processResourceId,
    timeoutMs: state.limits.operationTimeoutMs,
    reason: 'Session opening no longer owns this process.',
  });
};
