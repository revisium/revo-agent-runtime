import type { AgentFault } from '../../../../../contracts/manager/core.js';
import type { PublicSessionCommand } from '../../command/public.js';
import type { TimerCommand } from '../../command/timer.js';
import { reduceActiveTerminal } from '../terminal.js';
import { timerFault } from '../terminal/state.js';
import {
  appendEffect,
  nextEffectCorrelation,
  type SessionTransition,
  unchangedTransition,
} from '../transition.js';
import { idleFromCheckpoint, type CheckpointingState } from './state.js';

type ControlCommand =
  | Extract<PublicSessionCommand, { readonly type: 'session.close' | 'session.cancel' }>
  | TimerCommand;

const reject = (state: CheckpointingState, callId: string, fault: AgentFault) =>
  appendEffect(unchangedTransition(state), {
    callId,
    correlation: nextEffectCorrelation(state),
    fault,
    type: 'public.reject',
  });

const checkpointInterrupted = (command: ControlCommand): AgentFault => {
  if (command.type === 'timer.fired') {
    const kind = command.kind === 'idle' ? 'idle' : 'wall_clock';
    return timerFault(kind);
  }
  return {
    code: 'revo.agent.cancelled',
    message: 'Checkpoint capture was interrupted by session cancellation.',
    phase: 'session_checkpointing',
    retryable: false,
  };
};

const matchesTimer = (state: CheckpointingState, command: TimerCommand): boolean =>
  state.timers.some(
    (timer) =>
      timer.timerId === command.timerId &&
      timer.generation === command.generation &&
      timer.kind === command.kind &&
      (timer.kind === 'idle' || timer.kind === 'wall_clock'),
  );

const resolveCancellation = (
  transition: SessionTransition<CheckpointingState>,
  command: Extract<ControlCommand, { readonly type: 'session.cancel' }>,
): SessionTransition =>
  appendEffect(transition, {
    callId: command.call.callId,
    correlation: nextEffectCorrelation(transition.state),
    resolution: { kind: 'cancel_session', result: { state: 'requested' } },
    type: 'public.resolve',
  });

const deferredIntent = (command: ControlCommand) => {
  if (command.type !== 'timer.fired')
    return {
      ...(command.reason === undefined ? {} : { reason: command.reason }),
      outcome: 'cancelled' as const,
    };
  return {
    error: checkpointInterrupted(command),
    outcome: 'timed_out' as const,
    timeout: command.kind === 'idle' ? ('idle_timeout' as const) : ('wall_clock_timeout' as const),
  };
};

const deferTerminalControl = (
  state: CheckpointingState,
  command: Exclude<ControlCommand, { readonly type: 'session.close' }>,
): SessionTransition => {
  if (state.terminalAfterCheckpoint !== undefined) {
    if (command.type === 'timer.fired') return unchangedTransition(state);
    return resolveCancellation(unchangedTransition(state), command);
  }
  const transition = {
    effects: [],
    state: { ...state, terminalAfterCheckpoint: deferredIntent(command) },
  };
  return command.type === 'timer.fired' ? transition : resolveCancellation(transition, command);
};

export const reduceCheckpointControl = (
  state: CheckpointingState,
  command: ControlCommand,
): SessionTransition => {
  if (command.type === 'session.close')
    return reject(state, command.call.callId, {
      code: 'revo.agent.session_busy',
      message: 'Graceful close cannot interrupt checkpoint publication.',
      phase: 'session_checkpointing',
      retryable: true,
    });
  if (command.type === 'timer.fired' && !matchesTimer(state, command))
    return unchangedTransition(state);
  if (state.progress.stage === 'publishing') return deferTerminalControl(state, command);
  const terminal = reduceActiveTerminal(idleFromCheckpoint(state), command);
  return appendEffect(terminal, {
    callId: state.callId,
    correlation: nextEffectCorrelation(terminal.state),
    fault: checkpointInterrupted(command),
    type: 'public.reject',
  });
};
