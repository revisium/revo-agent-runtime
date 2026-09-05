import type { SessionCommand } from '../command/session-command.js';
import { isPersistenceOutcome } from './persistence/outcome.js';
import { cancelRunningSession, reduceTimer } from './terminal/control.js';
import { coalesceTerminalCommand, rejectBusyClose } from './terminal/intent.js';
import { reduceCleanupOutcome, reduceRemovalOutcome } from './terminal/lifecycle.js';
import { finishTerminal, reduceTerminalEventOutcome } from './terminal/publication.js';
import {
  beginTerminalCleanup,
  type ActiveSession,
  type TerminalizingSession,
} from './terminal/state.js';
import { reduceTerminalTurn } from './terminal/turn.js';
import { type SessionTransition, unchangedTransition } from './transition.js';

type EventOutcome = Extract<SessionCommand, { readonly type: `event.${string}` }>;
type OutputOutcome = Extract<SessionCommand, { readonly type: `output.${string}` }>;

const isEventOutcome = (command: SessionCommand): command is EventOutcome =>
  command.type === 'event.applied' ||
  command.type === 'event.failed' ||
  command.type === 'event.timed_out_then_applied' ||
  command.type === 'event.timed_out_then_failed' ||
  command.type === 'event.unknown';

const isOutputOutcome = (command: SessionCommand): command is OutputOutcome =>
  command.type === 'output.published' ||
  command.type === 'output.failed' ||
  command.type === 'output.uncertain';

export const reduceActiveTerminal = (
  state: ActiveSession,
  command: SessionCommand,
): SessionTransition => {
  if (
    state.status === 'idle' &&
    (command.type === 'session.close' || command.type === 'session.cancel')
  )
    return beginTerminalCleanup(state, command);
  if (state.status === 'running' && command.type === 'session.cancel')
    return cancelRunningSession(state, command);
  if (state.status === 'running' && command.type === 'session.close')
    return rejectBusyClose(state, command);
  if (command.type === 'timer.fired') return reduceTimer(state, command);
  return unchangedTransition(state);
};

export const reduceTerminalizing = (
  state: TerminalizingSession,
  command: SessionCommand,
): SessionTransition => {
  if (command.type === 'session.close' || command.type === 'session.cancel')
    return coalesceTerminalCommand(state, command);
  const turnTransition = reduceTerminalTurn(state, command);
  if (turnTransition !== undefined) return turnTransition;
  if (command.type === 'process.cleanup.confirmed' || command.type === 'process.cleanup.uncertain')
    return reduceCleanupOutcome(state, command);
  if (isPersistenceOutcome(command)) return reduceRemovalOutcome(state, command);
  if (isEventOutcome(command)) return reduceTerminalEventOutcome(state, command);
  if (isOutputOutcome(command)) return finishTerminal(state, command);
  return unchangedTransition(state);
};
