import type { SessionCommand } from '../command/session-command.js';
import { reduceOpeningEvent, startOpening } from './opening/events.js';
import { reduceOpeningCleanup } from './opening/failure.js';
import {
  reducePersistenceOutcome,
  reducePreparation,
  reduceProcessOutcome,
  reduceProviderOpenOutcome,
} from './opening/stages.js';
import { createOpeningSessionState, type OpeningState } from './opening/state.js';
import { reduceOpeningTimer } from './opening/timeouts.js';
import type { SessionTransition } from './transition.js';
import { unchangedTransition } from './transition.js';

export { createOpeningSessionState };

export const reduceOpeningSession = (
  state: OpeningState,
  command: SessionCommand,
): SessionTransition => {
  if (command.type === 'session.open' || command.type === 'session.resume')
    return startOpening(state, command);
  if (command.type === 'timer.fired') return reduceOpeningTimer(state, command);
  if (
    command.type === 'event.applied' ||
    command.type === 'event.timed_out_then_applied' ||
    command.type === 'event.failed' ||
    command.type === 'event.timed_out_then_failed' ||
    command.type === 'event.unknown'
  )
    return reduceOpeningEvent(state, command);
  if (
    command.type === 'opening.preparation.succeeded' ||
    command.type === 'opening.preparation.rejected' ||
    command.type === 'opening.preparation.failed' ||
    command.type === 'opening.preparation.timed_out'
  )
    return reducePreparation(state, command);
  if (
    command.type === 'process.started' ||
    command.type === 'process.failed' ||
    command.type === 'process.timed_out'
  )
    return reduceProcessOutcome(state, command);
  if (command.type === 'process.cleanup.confirmed' || command.type === 'process.cleanup.uncertain')
    return reduceOpeningCleanup(state, command);
  if (
    command.type === 'persistence.applied' ||
    command.type === 'persistence.failed' ||
    command.type === 'persistence.unknown'
  )
    return state.progress.stage === 'cleaning_process' || state.progress.stage === 'removing_state'
      ? reduceOpeningCleanup(state, command)
      : reducePersistenceOutcome(state, command);
  if (
    command.type === 'provider.opened' ||
    command.type === 'provider.open_failed' ||
    command.type === 'provider.open_timed_out'
  )
    return reduceProviderOpenOutcome(state, command);
  return unchangedTransition(state);
};
