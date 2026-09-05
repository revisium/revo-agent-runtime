import type { SessionEffect } from '../../../kernel/effect/session-effect.js';
import type { SessionEffectOutput } from '../../../runtime/effects/outcomes.js';

export interface SessionEffectHandler<Type extends SessionEffect['type']> {
  readonly type: Type;
  execute(effect: SessionEffect, output: SessionEffectOutput): void;
}
