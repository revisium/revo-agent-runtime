import type { TimerCommand } from '../../command/timer.js';
import { unchangedTransition, type SessionTransition } from '../transition.js';
import { beginOpeningProcessCleanup, failOpeningBeforeProcess } from './failure.js';
import { openingCleanupInProgress, type OpeningState } from './state.js';

export const reduceOpeningTimer = (
  state: OpeningState,
  command: TimerCommand,
): SessionTransition => {
  const timer = state.timers.find(({ timerId }) => timerId === command.timerId);
  if (
    openingCleanupInProgress(state) ||
    timer?.generation !== command.generation ||
    timer.kind !== command.kind ||
    (timer.kind !== 'opening' && timer.kind !== 'wall_clock')
  )
    return unchangedTransition(state);
  const fault = {
    code: 'revo.agent.timeout' as const,
    details: { timer: timer.kind },
    message:
      timer.kind === 'opening'
        ? 'The session opening deadline elapsed.'
        : 'The session deadline elapsed while opening.',
    phase: 'session_opening' as const,
    retryable: false,
  };
  if (!('process' in state.progress))
    return failOpeningBeforeProcess(state, fault, command.firedAt);
  const afterCleanup = state.progress.stage === 'saving_process' ? 'uncertain' : 'remove_state';
  return beginOpeningProcessCleanup(state, fault, afterCleanup);
};
