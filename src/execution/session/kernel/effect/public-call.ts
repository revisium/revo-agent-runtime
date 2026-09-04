import type { AgentFault } from '../../../../contracts/manager/core.js';
import type { RespondAgentSessionResult } from '../../../../contracts/session/interaction/response.js';
import type {
  AgentSessionCheckpoint,
  AgentSessionHibernateResult,
} from '../../../../contracts/session/lifecycle/checkpoint.js';
import type {
  CancelAgentSessionResult,
  CancelAgentSessionTurnResult,
  CloseAgentSessionResult,
} from '../../../../contracts/session/lifecycle/result.js';
import type { EffectCorrelation } from '../model/identity.js';

type PublicCallResolution =
  | { readonly kind: 'session_ready' }
  | { readonly kind: 'turn_ready'; readonly turnId: string }
  | { readonly kind: 'interaction'; readonly result: RespondAgentSessionResult }
  | { readonly kind: 'checkpoint'; readonly checkpoint: AgentSessionCheckpoint }
  | { readonly kind: 'hibernate'; readonly result: AgentSessionHibernateResult }
  | { readonly kind: 'close'; readonly result: CloseAgentSessionResult }
  | { readonly kind: 'cancel_session'; readonly result: CancelAgentSessionResult }
  | { readonly kind: 'cancel_turn'; readonly result: CancelAgentSessionTurnResult }
  | { readonly kind: 'shutdown_complete' };

interface ResolvePublicCallEffect {
  readonly type: 'public.resolve';
  readonly correlation: EffectCorrelation;
  readonly callId: string;
  readonly resolution: PublicCallResolution;
}

interface RejectPublicCallEffect {
  readonly type: 'public.reject';
  readonly correlation: EffectCorrelation;
  readonly callId: string;
  readonly fault: AgentFault;
}

export type SessionPublicCallEffect = ResolvePublicCallEffect | RejectPublicCallEffect;
