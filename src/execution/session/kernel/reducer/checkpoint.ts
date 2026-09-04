import type { SessionCommand } from '../command/session-command.js';
import type { SessionState } from '../model/session-state.js';
import { reduceCheckpointCapture } from './checkpoint/capture.js';
import { reduceCheckpointControl } from './checkpoint/control.js';
import { reduceCheckpointEvent } from './checkpoint/events.js';
import { reduceHibernation } from './checkpoint/hibernate.js';
import { startCheckpoint } from './checkpoint/start.js';
import type { SessionTransition } from './transition.js';

const isCaptureOutcome = (
  command: SessionCommand,
): command is Extract<SessionCommand, { readonly type: `checkpoint.${string}` }> =>
  command.type === 'checkpoint.captured' ||
  command.type === 'checkpoint.unsupported' ||
  command.type === 'checkpoint.failed' ||
  command.type === 'checkpoint.timed_out';

const isEventOutcome = (
  command: SessionCommand,
): command is Extract<SessionCommand, { readonly type: `event.${string}` }> =>
  command.type === 'event.applied' ||
  command.type === 'event.failed' ||
  command.type === 'event.timed_out_then_applied' ||
  command.type === 'event.timed_out_then_failed' ||
  command.type === 'event.unknown';

export const reduceCheckpointSession = (
  state: SessionState,
  command: SessionCommand,
): SessionTransition | undefined => {
  const hibernation = reduceHibernation(state, command);
  if (hibernation !== undefined) return hibernation;
  if (
    command.type === 'session.checkpoint' &&
    (state.status === 'idle' || state.status === 'running')
  )
    return startCheckpoint(state, command);
  if (state.status !== 'checkpointing') return undefined;
  if (
    command.type === 'session.close' ||
    command.type === 'session.cancel' ||
    command.type === 'timer.fired'
  )
    return reduceCheckpointControl(state, command);
  if (isCaptureOutcome(command)) return reduceCheckpointCapture(state, command);
  if (isEventOutcome(command)) return reduceCheckpointEvent(state, command);
  return undefined;
};
