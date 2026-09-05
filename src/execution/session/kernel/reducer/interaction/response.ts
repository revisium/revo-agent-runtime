import type { AgentFault } from '../../../../../contracts/manager/core.js';
import type { PublicSessionCommand } from '../../command/public.js';
import type { InteractionState } from '../../model/interaction-state.js';
import type { SessionState } from '../../model/session-state.js';
import {
  appendEffect,
  nextEffectCorrelation,
  type SessionTransition,
  unchangedTransition,
} from '../transition.js';
import { sameInteractionResponse, validInteractionResponse } from './validation.js';

type ActiveState = Extract<SessionState, { readonly status: 'opening' | 'idle' | 'running' }>;
type RespondCommand = Extract<PublicSessionCommand, { readonly type: 'interaction.respond' }>;

const reject = (state: ActiveState, command: RespondCommand, fault: AgentFault) =>
  appendEffect(unchangedTransition(state), {
    callId: command.call.callId,
    correlation: nextEffectCorrelation(state),
    fault,
    type: 'public.reject',
  });

const resolve = (
  transition: SessionTransition<ActiveState>,
  command: RespondCommand,
  result: 'accepted' | 'already_resolved',
) =>
  appendEffect(transition, {
    callId: command.call.callId,
    correlation: nextEffectCorrelation(transition.state),
    resolution: { kind: 'interaction', result: { state: result } },
    type: 'public.resolve',
  });

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

export const respondToInteraction = (
  state: ActiveState,
  command: RespondCommand,
): SessionTransition => {
  const interaction = state.interactions.find(
    ({ request }) => request.requestId === command.input.requestId,
  );
  if (interaction === undefined)
    return reject(state, command, {
      code: 'revo.agent.interaction_unknown',
      message: 'The interaction request is unknown.',
      phase: 'session_running',
      retryable: false,
    });
  if (interaction.stage === 'responding')
    return sameInteractionResponse(interaction.response, command.input.response)
      ? resolve(unchangedTransition(state), command, 'already_resolved')
      : reject(state, command, {
          code: 'revo.agent.interaction_conflict',
          message: 'The interaction already has a different reserved response.',
          phase: 'session_running',
          retryable: false,
        });
  if (!validInteractionResponse(interaction.request, command.input.response))
    return reject(state, command, {
      code: 'revo.agent.interaction_invalid',
      message: 'The response does not satisfy the interaction request.',
      phase: 'session_running',
      retryable: false,
    });
  const responding: InteractionState = {
    ...interaction,
    delivery: { stage: 'publishing' },
    response: command.input.response,
    stage: 'responding',
  };
  let transition = resolve(
    { effects: [], state: replaceInteraction(state, command.input.requestId, responding) },
    command,
    'accepted',
  );
  if (interaction.stage === 'publishing') return transition;
  const correlation = nextEffectCorrelation(transition.state);
  transition = {
    effects: transition.effects,
    state: replaceInteraction(transition.state, command.input.requestId, {
      ...responding,
      delivery: { correlation, stage: 'delivering' },
    }),
  };
  return appendEffect(transition, {
    correlation,
    providerResourceId: interaction.providerResourceId,
    request: interaction.request,
    response: command.input.response,
    scope: interaction.scope,
    timeoutMs: state.limits.operationTimeoutMs,
    type: 'provider.interaction.respond',
  });
};
