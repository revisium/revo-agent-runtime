import type { AgentFault } from '../../../../../../contracts/manager/core.js';
import type { PublicSessionCommand } from '../../../command/public.js';
import type { TimerCommand } from '../../../command/timer.js';
import { reduceActiveTerminal } from '../../terminal.js';
import { terminalizingState } from '../../terminal/state.js';
import {
  appendEffect,
  nextEffectCorrelation,
  type SessionTransition,
  unchangedTransition,
} from '../../transition.js';
import { idleFromHibernation, type HibernatingState } from './state.js';

type ControlCommand =
  | Extract<PublicSessionCommand, { readonly type: 'session.close' | 'session.cancel' }>
  | TimerCommand;

const cancelledFault = (): AgentFault => ({
  code: 'revo.agent.cancelled',
  message: 'Hibernation was interrupted by session cancellation.',
  phase: 'session_checkpointing',
  retryable: false,
});

const appendRejection = (
  transition: SessionTransition,
  state: HibernatingState,
  fault: AgentFault,
): SessionTransition =>
  appendEffect(transition, {
    callId: state.callId,
    correlation: nextEffectCorrelation(transition.state),
    fault,
    type: 'public.reject',
  });

const resolveCancel = (
  transition: SessionTransition,
  command: Extract<ControlCommand, { readonly type: 'session.cancel' }>,
  result: 'requested' | 'already_terminal',
): SessionTransition =>
  appendEffect(transition, {
    callId: command.call.callId,
    correlation: nextEffectCorrelation(transition.state),
    resolution: { kind: 'cancel_session', result: { state: result } },
    type: 'public.resolve',
  });

const matchesTimer = (state: HibernatingState, command: TimerCommand): boolean =>
  state.timers.some(
    (timer) =>
      timer.timerId === command.timerId &&
      timer.generation === command.generation &&
      timer.kind === command.kind &&
      (timer.kind === 'idle' || timer.kind === 'wall_clock'),
  );

export const reduceHibernationControl = (
  state: HibernatingState,
  command: ControlCommand,
): SessionTransition => {
  if (command.type === 'session.close')
    return appendRejection(unchangedTransition(state), state, {
      code: 'revo.agent.session_busy',
      message: 'Graceful close cannot interrupt hibernation.',
      phase: 'session_checkpointing',
      retryable: true,
    });
  if (command.type === 'timer.fired' && !matchesTimer(state, command))
    return unchangedTransition(state);
  if (state.progress.stage === 'capturing') {
    const transition = reduceActiveTerminal(idleFromHibernation(state), command);
    const fault =
      transition.state.status === 'cancelling' && transition.state.intent.outcome === 'timed_out'
        ? transition.state.intent.error
        : cancelledFault();
    return appendRejection(transition, state, fault);
  }
  if (command.type === 'timer.fired') return unchangedTransition(state);
  if (state.progress.stage === 'publishing_output' || state.progress.stage === 'publishing')
    return resolveCancel(unchangedTransition(state), command, 'already_terminal');
  const intent = {
    ...(command.reason === undefined ? {} : { reason: command.reason }),
    outcome: 'cancelled' as const,
  };
  const terminal = terminalizingState(idleFromHibernation(state), intent, {
    correlation: state.progress.correlation,
    stage: state.progress.stage === 'removing_state' ? 'removing_state' : 'cleaning_process',
  });
  const rejected = appendRejection({ effects: [], state: terminal }, state, cancelledFault());
  return resolveCancel(rejected, command, 'requested');
};
