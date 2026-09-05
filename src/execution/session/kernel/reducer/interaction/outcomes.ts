import type { InteractionResolvedEvent } from '../../../../../contracts/session/events/event.js';
import type { SessionCommand } from '../../command/session-command.js';
import type { InteractionState } from '../../model/interaction-state.js';
import type { SessionState } from '../../model/session-state.js';
import {
  nextSessionEventId,
  queueSessionEvent,
  type SessionTransition,
  unchangedTransition,
} from '../transition.js';
import { failInteractionSession } from './failure.js';

type ActiveState = Extract<SessionState, { readonly status: 'opening' | 'idle' | 'running' }>;
type InteractionOutcome = Extract<
  SessionCommand,
  { readonly type: `provider.interaction.${string}` }
>;

export const reduceInteractionOutcome = (
  state: ActiveState,
  command: InteractionOutcome,
): SessionTransition => {
  const interaction = state.interactions.find(
    (candidate): candidate is Extract<InteractionState, { readonly stage: 'responding' }> =>
      candidate.stage === 'responding' &&
      candidate.delivery.stage === 'delivering' &&
      candidate.delivery.correlation.effectId === command.correlation.effectId,
  );
  if (interaction === undefined) return unchangedTransition(state);
  if (command.type !== 'provider.interaction.accepted')
    return failInteractionSession(state, command.fault);
  const event: InteractionResolvedEvent = {
    eventId: nextSessionEventId(state),
    observedAt: command.observedAt,
    requestId: interaction.request.requestId,
    response: interaction.response,
    schemaVersion: 'agent-session-event/v1',
    scope: interaction.scope,
    sequence: state.nextEventSequence,
    sessionId: state.sessionId,
    streamId: state.streamId,
    type: 'interaction.resolved',
  };
  return queueSessionEvent(state, event);
};
