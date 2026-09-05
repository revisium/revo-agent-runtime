import type { SessionCommand } from '../../command/session-command.js';
import type { SessionState } from '../../model/session-state.js';
import { isPersistenceOutcome } from '../persistence/outcome.js';
import type { SessionTransition } from '../transition.js';
import { reduceHibernationCapture } from './hibernate/capture.js';
import { reduceHibernationControl } from './hibernate/control.js';
import { reduceHibernationEvent } from './hibernate/events.js';
import {
  reduceHibernationCleanup,
  reduceHibernationOutput,
  reduceHibernationRemoval,
} from './hibernate/lifecycle.js';
import { startHibernation } from './hibernate/start.js';

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

export const reduceHibernation = (
  state: SessionState,
  command: SessionCommand,
): SessionTransition | undefined => {
  if (
    command.type === 'session.hibernate' &&
    (state.status === 'idle' || state.status === 'running')
  )
    return startHibernation(state, command);
  if (state.status !== 'hibernating') return undefined;
  if (
    command.type === 'session.close' ||
    command.type === 'session.cancel' ||
    command.type === 'timer.fired'
  )
    return reduceHibernationControl(state, command);
  if (isCaptureOutcome(command)) return reduceHibernationCapture(state, command);
  if (command.type === 'process.cleanup.confirmed' || command.type === 'process.cleanup.uncertain')
    return reduceHibernationCleanup(state, command);
  if (isPersistenceOutcome(command)) return reduceHibernationRemoval(state, command);
  if (
    command.type === 'output.published' ||
    command.type === 'output.failed' ||
    command.type === 'output.uncertain'
  )
    return reduceHibernationOutput(state, command);
  if (isEventOutcome(command)) return reduceHibernationEvent(state, command);
  return undefined;
};
