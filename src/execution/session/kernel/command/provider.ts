import type { AgentSessionPlanItem } from '../../../../contracts/session/events/event.js';
import type {
  AgentSessionInteractionScope,
  AgentSessionInteractiveRequest,
} from '../../../../contracts/session/interaction/request.js';
import type { AgentSessionUsage } from '../../../../contracts/session/lifecycle/result.js';
import type { EffectCorrelation, TurnEffectCorrelation } from '../model/identity.js';

interface ProviderCommandBase<Correlation extends EffectCorrelation = EffectCorrelation> {
  readonly correlation: Correlation;
  readonly observedAt: string;
  readonly observedAtMs: number;
}

interface ProviderMessageDeltaCommand extends ProviderCommandBase<TurnEffectCorrelation> {
  readonly type: 'provider.message_delta';
  readonly content: string;
}

interface ProviderMessageCompletedCommand extends ProviderCommandBase<TurnEffectCorrelation> {
  readonly type: 'provider.message_completed';
  readonly contentBytes: number;
  readonly contentSha256: string;
}

interface ProviderProgressCommand extends ProviderCommandBase<TurnEffectCorrelation> {
  readonly type: 'provider.progress';
  readonly message: string;
}

interface ProviderToolCommand extends ProviderCommandBase<TurnEffectCorrelation> {
  readonly type: 'provider.tool';
  readonly toolCallId: string;
  readonly kind: 'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'fetch' | 'other';
  readonly title: string;
  readonly status: 'started' | 'in_progress' | 'completed' | 'failed';
}

interface ProviderPlanCommand extends ProviderCommandBase<TurnEffectCorrelation> {
  readonly type: 'provider.plan';
  readonly items: readonly AgentSessionPlanItem[];
}

interface ProviderInteractionRequestedCommand extends ProviderCommandBase {
  readonly type: 'provider.interaction_requested';
  readonly providerResourceId: string;
  readonly scope: AgentSessionInteractionScope;
  readonly request: AgentSessionInteractiveRequest;
}

interface ProviderUsageCommand extends ProviderCommandBase<TurnEffectCorrelation> {
  readonly type: 'provider.usage';
  readonly usage: AgentSessionUsage;
}

export type ProviderCommand =
  | ProviderMessageDeltaCommand
  | ProviderMessageCompletedCommand
  | ProviderProgressCommand
  | ProviderToolCommand
  | ProviderPlanCommand
  | ProviderInteractionRequestedCommand
  | ProviderUsageCommand;
