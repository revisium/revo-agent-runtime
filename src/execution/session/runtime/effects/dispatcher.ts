import type { SessionEffect } from '../../kernel/effect/session-effect.js';
import type { SessionEffectOutput } from './outcomes.js';

type RuntimeEffect = Extract<
  SessionEffect,
  { readonly type: 'public.resolve' | 'public.reject' | 'timer.schedule' | 'timer.cancel' }
>;

export type InterpretedSessionEffect = Exclude<SessionEffect, RuntimeEffect>;

export interface SessionEffectInterpreter {
  readonly type: InterpretedSessionEffect['type'];
  execute(effect: InterpretedSessionEffect, output: SessionEffectOutput): void;
}

export class SessionEffectDispatcher {
  readonly #handlers = new Map<InterpretedSessionEffect['type'], SessionEffectInterpreter>();

  constructor(interpreters: readonly SessionEffectInterpreter[]) {
    for (const interpreter of interpreters) {
      if (this.#handlers.has(interpreter.type))
        throw new Error(`Duplicate session effect interpreter: ${interpreter.type}`);
      this.#handlers.set(interpreter.type, interpreter);
    }
  }

  dispatch(effect: InterpretedSessionEffect, output: SessionEffectOutput): boolean {
    const handler = this.#handlers.get(effect.type);
    if (handler === undefined) return false;
    handler.execute(effect, output);
    return true;
  }
}
