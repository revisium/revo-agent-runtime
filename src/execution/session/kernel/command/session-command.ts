import type { EffectOutcomeCommand } from './effect.js';
import type { ProviderCommand } from './provider.js';
import type { PublicSessionCommand } from './public.js';
import type { TimerCommand } from './timer.js';

export type SessionCommand =
  | PublicSessionCommand
  | ProviderCommand
  | EffectOutcomeCommand
  | TimerCommand;
