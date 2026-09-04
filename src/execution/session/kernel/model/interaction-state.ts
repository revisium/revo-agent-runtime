import type {
  AgentSessionInteractionScope,
  AgentSessionInteractiveRequest,
} from '../../../../contracts/session/interaction/request.js';
import type { AgentSessionInteractiveResponse } from '../../../../contracts/session/interaction/response.js';
import type { EffectCorrelation } from './identity.js';

interface InteractionStateBase {
  readonly scope: AgentSessionInteractionScope;
  readonly request: AgentSessionInteractiveRequest;
}

interface PublishingInteractionState extends InteractionStateBase {
  readonly stage: 'publishing';
}

interface ReadyInteractionState extends InteractionStateBase {
  readonly stage: 'ready';
}

export type InteractionResponseDelivery =
  | { readonly stage: 'publishing' }
  | { readonly stage: 'delivering'; readonly correlation: EffectCorrelation };

interface RespondingInteractionState extends InteractionStateBase {
  readonly stage: 'responding';
  readonly response: AgentSessionInteractiveResponse;
  readonly delivery: InteractionResponseDelivery;
}

export type InteractionState =
  | PublishingInteractionState
  | ReadyInteractionState
  | RespondingInteractionState;
