import type { ActiveAgentSessionSnapshot } from '../../../../contracts/session/persistence/active-state.js';
import type { EffectCorrelation } from '../model/identity.js';

interface PersistenceEffectBase {
  readonly correlation: EffectCorrelation;
  readonly timeoutMs: number;
}

interface SaveActiveSessionStateEffect extends PersistenceEffectBase {
  readonly type: 'persistence.save';
  readonly snapshot: ActiveAgentSessionSnapshot;
}

interface RemoveActiveSessionStateEffect extends PersistenceEffectBase {
  readonly type: 'persistence.remove';
  readonly incarnationId: string;
}

export type SessionPersistenceEffect =
  | SaveActiveSessionStateEffect
  | RemoveActiveSessionStateEffect;
