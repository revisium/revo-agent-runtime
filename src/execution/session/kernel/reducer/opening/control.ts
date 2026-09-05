import type { PublicSessionCommand } from '../../command/public.js';
import {
  appendEffect,
  nextEffectCorrelation,
  unchangedTransition,
  type SessionTransition,
} from '../transition.js';
import { beginOpeningProcessCleanup, failOpeningBeforeProcess } from './failure.js';
import { openingCleanupInProgress, type OpeningState } from './state.js';

export const cancelOpening = (
  state: OpeningState,
  command: Extract<PublicSessionCommand, { readonly type: 'session.cancel' | 'manager.shutdown' }>,
): SessionTransition => {
  const fault = {
    code: 'revo.agent.cancelled' as const,
    message: 'Session opening was cancelled.',
    phase: 'session_opening' as const,
    retryable: false,
  };
  let transition: SessionTransition = unchangedTransition(state);
  if (!openingCleanupInProgress(state)) {
    transition =
      'process' in state.progress
        ? beginOpeningProcessCleanup(
            state,
            fault,
            state.progress.stage === 'saving_process' ? 'uncertain' : 'remove_state',
          )
        : failOpeningBeforeProcess(state, fault, command.observedAt);
  }
  return appendEffect(transition, {
    type: 'public.resolve',
    correlation: nextEffectCorrelation(transition.state),
    callId: command.call.callId,
    resolution: { kind: 'cancel_session', result: { state: 'requested' } },
  });
};
