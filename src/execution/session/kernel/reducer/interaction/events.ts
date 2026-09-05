import type { SessionCommand } from '../../command/session-command.js';
import type { InteractionState } from '../../model/interaction-state.js';
import type { SessionState } from '../../model/session-state.js';
import { pauseInactivity, resetInactivity } from '../timer/inactivity.js';
import {
  acknowledgeSessionEvent,
  appendEffect,
  nextEffectCorrelation,
  type SessionTransition,
  unchangedTransition,
} from '../transition.js';
import { failInteractionSession } from './failure.js';

type ActiveState = Extract<SessionState, { readonly status: 'opening' | 'idle' | 'running' }>;
type EventOutcome = Extract<SessionCommand, { readonly type: `event.${string}` }>;

const replaceInteraction = (
  state: ActiveState,
  requestId: string,
  interaction: InteractionState,
): ActiveState => ({
  ...state,
  interactions: state.interactions.map((candidate) =>
    candidate.request.requestId === requestId ? interaction : candidate,
  ),
});

export const reduceInteractionEvent = (
  state: ActiveState,
  command: EventOutcome,
): SessionTransition => {
  if (state.events.inFlight?.correlation.effectId !== command.correlation.effectId)
    return unchangedTransition(state);
  if (command.type !== 'event.applied' && command.type !== 'event.timed_out_then_applied')
    return failInteractionSession(state, command.fault);
  if (command.result.state !== 'appended')
    return failInteractionSession(state, {
      code: 'revo.agent.event_conflict',
      message: 'Agent session event append conflicted with durable history.',
      phase: 'session_delivery',
      retryable: false,
    });
  // The in-flight correlation was matched above, so acknowledgement is total here.
  const acknowledged = acknowledgeSessionEvent(state, command.correlation)!;
  if (acknowledged.event.type === 'interaction.resolved') {
    const requestId = acknowledged.event.requestId;
    const interactions = acknowledged.transition.state.interactions.filter(
      ({ request }) => request.requestId !== requestId,
    );
    const nextState: ActiveState =
      acknowledged.transition.state.status === 'running' &&
      acknowledged.transition.state.turn.status === 'awaiting_interaction' &&
      interactions.length === 0
        ? {
            ...acknowledged.transition.state,
            interactions,
            turn: { ...acknowledged.transition.state.turn, status: 'streaming' },
          }
        : { ...acknowledged.transition.state, interactions };
    const transition = { effects: acknowledged.transition.effects, state: nextState };
    return interactions.length === 0 && transition.state.status !== 'opening'
      ? resetInactivity(transition, command.observedAtMs)
      : transition;
  }
  if (acknowledged.event.type !== 'interaction.requested') return acknowledged.transition;
  const requestId = acknowledged.event.request.requestId;
  const interaction = state.interactions.find(({ request }) => request.requestId === requestId);
  if (interaction === undefined) return acknowledged.transition;
  if (interaction.stage !== 'responding')
    return pauseInactivity({
      effects: acknowledged.transition.effects,
      state: replaceInteraction(acknowledged.transition.state, requestId, {
        ...interaction,
        stage: 'ready',
      }),
    });
  const paused = pauseInactivity(acknowledged.transition);
  const correlation = nextEffectCorrelation(paused.state);
  return appendEffect(
    {
      effects: paused.effects,
      state: replaceInteraction(paused.state, requestId, {
        ...interaction,
        delivery: { correlation, stage: 'delivering' },
      }),
    },
    {
      correlation,
      providerResourceId: interaction.providerResourceId,
      request: interaction.request,
      response: interaction.response,
      scope: interaction.scope,
      timeoutMs: state.limits.operationTimeoutMs,
      type: 'provider.interaction.respond',
    },
  );
};
