import type { InteractionRequestedEvent } from '../../../../../contracts/session/events/event.js';
import type { ProviderCommand } from '../../command/provider.js';
import type { SessionState } from '../../model/session-state.js';
import { nextSessionEventId, queueSessionEvent, type SessionTransition } from '../transition.js';
import { failInteractionSession } from './failure.js';
import { sameInteractionRequest } from './matching.js';

type RequestState = Extract<SessionState, { readonly status: 'opening' | 'running' }>;
type InteractionRequest = Extract<
  ProviderCommand,
  { readonly type: 'provider.interaction_requested' }
>;

const requestedEvent = (
  state: RequestState,
  command: InteractionRequest,
): InteractionRequestedEvent => ({
  eventId: nextSessionEventId(state),
  observedAt: command.observedAt,
  request: command.request,
  schemaVersion: 'agent-session-event/v1',
  scope: command.scope,
  sequence: state.nextEventSequence,
  sessionId: state.sessionId,
  streamId: state.streamId,
  type: 'interaction.requested',
});

export const requestInteraction = (
  state: RequestState,
  command: InteractionRequest,
): SessionTransition => {
  if (state.status === 'opening') {
    if (
      state.progress.stage !== 'opening_provider' ||
      state.progress.correlation.effectId !== command.correlation.effectId ||
      command.scope.kind !== 'opening'
    )
      return { effects: [], state };
  } else {
    const turn = state.turn;
    if (
      turn.status === 'starting' ||
      turn.status === 'settling' ||
      turn.correlation.effectId !== command.correlation.effectId ||
      turn.turnId !== command.correlation.turnId ||
      command.scope.kind !== 'turn' ||
      command.scope.turnId !== turn.turnId
    )
      return { effects: [], state };
  }
  const existing = state.interactions.find(
    ({ request }) => request.requestId === command.request.requestId,
  );
  if (existing !== undefined)
    return sameInteractionRequest(existing.request, command.request)
      ? { effects: [], state }
      : failInteractionSession(state, {
          code: 'revo.agent.interaction_conflict',
          message: 'The provider reused an interaction identifier for a different request.',
          phase: 'session_running',
          retryable: false,
        });
  if (state.status === 'running' && !state.capabilities.interactions[command.request.kind])
    return failInteractionSession(state, {
      code: 'revo.agent.protocol_failed',
      message: 'The provider emitted an interaction capability it did not negotiate.',
      phase: 'session_running',
      retryable: false,
    });
  if (state.interactions.length >= state.limits.maxPendingInteractions)
    return failInteractionSession(state, {
      code: 'revo.agent.session_backpressure',
      message: 'The provider exceeded the pending interaction limit.',
      phase: 'session_running',
      retryable: true,
    });
  const interaction = {
    providerResourceId: command.providerResourceId,
    request: command.request,
    scope: command.scope,
    stage: 'publishing' as const,
  };
  if (state.status === 'opening')
    return queueSessionEvent(
      { ...state, interactions: [...state.interactions, interaction] },
      requestedEvent(state, command),
    );
  const turn = state.turn;
  if (turn.status === 'starting' || turn.status === 'settling') return { effects: [], state };
  return queueSessionEvent(
    {
      ...state,
      interactions: [...state.interactions, interaction],
      turn: { ...turn, status: 'awaiting_interaction' },
    },
    requestedEvent(state, command),
  );
};
