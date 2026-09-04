import type { SessionCommand } from '../command/session-command.js';
import type { SessionState } from '../model/session-state.js';
import { reduceInteractionEvent } from './interaction/events.js';
import { reduceInteractionOutcome } from './interaction/outcomes.js';
import { requestInteraction } from './interaction/request.js';
import { respondToInteraction } from './interaction/response.js';
import type { SessionTransition } from './transition.js';

type ActiveInteractionState = Extract<
  SessionState,
  { readonly status: 'opening' | 'idle' | 'running' }
>;

const isEventOutcome = (
  command: SessionCommand,
): command is Extract<SessionCommand, { readonly type: `event.${string}` }> =>
  command.type === 'event.applied' ||
  command.type === 'event.failed' ||
  command.type === 'event.timed_out_then_applied' ||
  command.type === 'event.timed_out_then_failed' ||
  command.type === 'event.unknown';

export const reduceInteractionSession = (
  state: ActiveInteractionState,
  command: SessionCommand,
): SessionTransition | undefined => {
  if (command.type === 'provider.interaction_requested')
    return state.status === 'opening' || state.status === 'running'
      ? requestInteraction(state, command)
      : undefined;
  if (command.type === 'interaction.respond') return respondToInteraction(state, command);
  if (
    command.type === 'provider.interaction.accepted' ||
    command.type === 'provider.interaction.rejected' ||
    command.type === 'provider.interaction.failed' ||
    command.type === 'provider.interaction.timed_out'
  )
    return reduceInteractionOutcome(state, command);
  if (
    isEventOutcome(command) &&
    (state.events.inFlight?.event.type === 'interaction.requested' ||
      state.events.inFlight?.event.type === 'interaction.resolved')
  )
    return reduceInteractionEvent(state, command);
  return undefined;
};
