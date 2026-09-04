import type {
  AgentSessionInteractionScope,
  AgentSessionInteractiveRequest,
} from '../../../../contracts/session/interaction/request.js';
import type { AgentSessionInteractiveResponse } from '../../../../contracts/session/interaction/response.js';
import type { SendAgentSessionInput } from '../../../../contracts/session/requests/send.js';
import type { EffectCorrelation, TurnEffectCorrelation } from '../model/identity.js';

interface ProviderEffectBase<Correlation extends EffectCorrelation = EffectCorrelation> {
  readonly correlation: Correlation;
  readonly timeoutMs: number;
}

interface StartSessionProcessEffect extends ProviderEffectBase {
  readonly type: 'process.start';
  readonly preparationId: string;
}

interface OpenProviderSessionEffect extends ProviderEffectBase {
  readonly type: 'provider.open';
  readonly preparationId: string;
  readonly processResourceId: string;
}

interface PromptProviderEffect extends ProviderEffectBase<TurnEffectCorrelation> {
  readonly type: 'provider.prompt';
  readonly providerResourceId: string;
  readonly input: SendAgentSessionInput;
}

interface RespondProviderInteractionEffect extends ProviderEffectBase {
  readonly type: 'provider.interaction.respond';
  readonly providerResourceId: string;
  readonly scope: AgentSessionInteractionScope;
  readonly request: AgentSessionInteractiveRequest;
  readonly response: AgentSessionInteractiveResponse;
}

interface CancelProviderTurnEffect extends ProviderEffectBase<TurnEffectCorrelation> {
  readonly type: 'provider.turn.cancel';
  readonly providerResourceId: string;
  readonly turnId: string;
  readonly reason?: string;
}

interface CloseProviderSessionEffect extends ProviderEffectBase {
  readonly type: 'provider.close';
  readonly providerResourceId: string;
  readonly reason?: string;
}

export type SessionProviderEffect =
  | StartSessionProcessEffect
  | OpenProviderSessionEffect
  | PromptProviderEffect
  | RespondProviderInteractionEffect
  | CancelProviderTurnEffect
  | CloseProviderSessionEffect;
