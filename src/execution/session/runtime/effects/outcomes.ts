import type {
  SessionEffectOutcome,
  SessionProviderUpdate,
} from '../../kernel/effect/session-effect.js';

export type ProviderUpdateAdmission = 'accepted' | 'overflow';
export type ProviderUpdateCompletion = 'processed' | 'stale';

export interface SessionEffectOutput {
  outcome(command: SessionEffectOutcome): void;
  update(command: SessionProviderUpdate): Promise<ProviderUpdateCompletion>;
  offerUpdate(command: SessionProviderUpdate): ProviderUpdateAdmission;
}
