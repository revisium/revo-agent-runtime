import type { EffectOutcomeCommand } from '../../command/effect.js';
import type { SessionState } from '../../model/session-state.js';
import { idleFromHibernation } from '../checkpoint/hibernate/state.js';
import { idleFromCheckpoint } from '../checkpoint/state.js';
import { beginOpeningProcessCleanup } from '../opening/failure.js';
import { failActiveSession } from '../terminal/control.js';
import {
  appendEffect,
  nextEffectCorrelation,
  unchangedTransition,
  type SessionTransition,
} from '../transition.js';

export const reduceProcessExit = (
  state: SessionState,
  command: Extract<EffectOutcomeCommand, { readonly type: 'process.exited' }>,
): SessionTransition => {
  if (state.status === 'opening') {
    if (
      !('processResourceId' in state.progress) ||
      state.progress.processResourceId !== command.processResourceId
    )
      return unchangedTransition(state);
    if (state.progress.stage === 'cleaning_process') return unchangedTransition(state);
    return beginOpeningProcessCleanup(
      state,
      command.fault,
      state.progress.stage === 'saving_process' ? 'uncertain' : 'remove_state',
    );
  }
  if (!('processResourceId' in state) || state.processResourceId !== command.processResourceId)
    return unchangedTransition(state);
  if (state.status === 'idle' || state.status === 'running')
    return failActiveSession(state, command.fault);
  if (state.status === 'checkpointing' || state.status === 'hibernating') {
    const idle =
      state.status === 'checkpointing' ? idleFromCheckpoint(state) : idleFromHibernation(state);
    const transition = failActiveSession(idle, command.fault);
    return appendEffect(transition, {
      type: 'public.reject',
      correlation: nextEffectCorrelation(transition.state),
      callId: state.callId,
      fault: command.fault,
    });
  }
  return unchangedTransition(state);
};
