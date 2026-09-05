import type { AgentFault } from '../../../../../contracts/manager/core.js';
import type { PublicSessionCommand } from '../../command/public.js';
import type { SessionState } from '../../model/session-state.js';
import {
  appendEffect,
  nextEffectCorrelation,
  unchangedTransition,
  type SessionTransition,
} from '../transition.js';

export const rejectPublicCommand = (
  state: SessionState,
  command: PublicSessionCommand,
  code: AgentFault['code'],
  message: string,
): SessionTransition => {
  const fault: AgentFault = {
    code,
    message,
    phase: 'session_running',
    retryable: code === 'revo.agent.session_busy',
  };
  let transition = appendEffect(unchangedTransition(state), {
    type: 'public.reject',
    correlation: nextEffectCorrelation(state),
    callId: command.call.callId,
    fault,
  });
  if (command.type === 'turn.send')
    transition = appendEffect(transition, {
      type: 'public.reject',
      correlation: nextEffectCorrelation(transition.state),
      callId: command.resultCallId,
      fault,
    });
  return transition;
};

export const settleInactiveCommand = (
  state: SessionState,
  command: PublicSessionCommand,
): SessionTransition => {
  const terminal =
    state.status === 'closed' ||
    state.status === 'cancelled' ||
    state.status === 'failed' ||
    state.status === 'timed_out' ||
    state.status === 'hibernated' ||
    state.status === 'cleanup_uncertain';
  if (
    terminal &&
    (command.type === 'session.close' ||
      command.type === 'session.cancel' ||
      command.type === 'turn.cancel')
  ) {
    const resolution =
      command.type === 'session.close'
        ? { kind: 'close' as const, result: { state: 'already_terminal' as const } }
        : command.type === 'session.cancel'
          ? { kind: 'cancel_session' as const, result: { state: 'already_terminal' as const } }
          : { kind: 'cancel_turn' as const, result: { state: 'session_terminal' as const } };
    return appendEffect(unchangedTransition(state), {
      type: 'public.resolve',
      correlation: nextEffectCorrelation(state),
      callId: command.call.callId,
      resolution,
    });
  }
  if (
    command.type === 'turn.cancel' &&
    'lastTurn' in state &&
    state.lastTurn?.turnId === command.turnId
  )
    return appendEffect(unchangedTransition(state), {
      type: 'public.resolve',
      correlation: nextEffectCorrelation(state),
      callId: command.call.callId,
      resolution: {
        kind: 'cancel_turn',
        result: { state: 'already_completed', result: state.lastTurn.result },
      },
    });
  return rejectPublicCommand(
    state,
    command,
    terminal ? 'revo.agent.session_closed' : 'revo.agent.session_busy',
    terminal
      ? 'The session is terminal.'
      : 'The session cannot accept this command in its current state.',
  );
};
