import type { EffectOutcomeCommand } from '../../kernel/command/effect.js';
import type { SessionCommand } from '../../kernel/command/session-command.js';
import type { SessionEffect } from '../../kernel/effect/session-effect.js';
import type { MailboxAdmissionOptions } from './queue.js';

export const MAX_CONCURRENT_EFFECTS = 16;
export const MAX_QUEUED_EVENTS = 128;

const providerUpdateTypes: ReadonlySet<string> = new Set([
  'provider.message_delta',
  'provider.message_completed',
  'provider.progress',
  'provider.tool',
  'provider.plan',
  'provider.interaction_requested',
  'provider.usage',
]);

export const requiresOutcomeCredit = (effect: SessionEffect): boolean => {
  switch (effect.type) {
    case 'opening.prepare':
    case 'process.start':
    case 'provider.open':
    case 'provider.prompt':
    case 'provider.interaction.respond':
    case 'event.append':
    case 'persistence.save':
    case 'persistence.remove':
    case 'checkpoint.capture':
    case 'output.publish':
    case 'process.cleanup':
      return true;
    case 'provider.turn.cancel':
    case 'provider.close':
    case 'timer.schedule':
    case 'timer.cancel':
    case 'public.resolve':
    case 'public.reject':
      return false;
  }
  return false;
};

export const isEffectOutcomeCommand = (
  command: SessionCommand,
): command is EffectOutcomeCommand => {
  if ('call' in command || command.type === 'timer.fired') return false;
  return !providerUpdateTypes.has(command.type);
};

export const commandAdmission = (command: SessionCommand): MailboxAdmissionOptions => {
  if ('call' in command) {
    if (command.type === 'session.cancel') return { key: 'cancel', lane: 'control' };
    if (command.type === 'session.close') return { key: 'close', lane: 'control' };
    if (command.type === 'manager.shutdown') return { key: 'shutdown', lane: 'control' };
    return { lane: 'ordinary' };
  }
  if (!isEffectOutcomeCommand(command) && command.type !== 'timer.fired')
    return { lane: 'provider_update' };
  return { lane: 'reserved' };
};

const matchesOutcomeFamily = (effect: SessionEffect, outcome: EffectOutcomeCommand): boolean => {
  switch (effect.type) {
    case 'opening.prepare':
      return outcome.type.startsWith('opening.preparation.');
    case 'process.start':
      return (
        outcome.type === 'process.started' ||
        outcome.type === 'process.failed' ||
        outcome.type === 'process.timed_out'
      );
    case 'provider.open':
      return outcome.type.startsWith('provider.open');
    case 'provider.prompt':
      return (
        outcome.type.startsWith('provider.prompt.') && outcome.type !== 'provider.prompt.accepted'
      );
    case 'provider.interaction.respond':
      return outcome.type.startsWith('provider.interaction.');
    case 'event.append':
      return outcome.type.startsWith('event.');
    case 'persistence.save':
    case 'persistence.remove':
      return outcome.type.startsWith('persistence.');
    case 'checkpoint.capture':
      return outcome.type.startsWith('checkpoint.');
    case 'process.cleanup':
      return outcome.type.startsWith('process.cleanup.');
    case 'output.publish':
      return outcome.type.startsWith('output.');
    case 'provider.turn.cancel':
    case 'provider.close':
    case 'timer.schedule':
    case 'timer.cancel':
    case 'public.resolve':
    case 'public.reject':
      return false;
  }
  return false;
};

const matchesCorrelation = (effect: SessionEffect, outcome: EffectOutcomeCommand): boolean =>
  effect.correlation.effectId === outcome.correlation.effectId &&
  effect.correlation.sessionId === outcome.correlation.sessionId &&
  effect.correlation.epoch === outcome.correlation.epoch &&
  effect.correlation.turnId === outcome.correlation.turnId;

export class OutcomeCreditLedger {
  readonly #effects = new Map<string, SessionEffect>();

  get size(): number {
    return this.#effects.size;
  }

  has(effectId: string): boolean {
    return this.#effects.has(effectId);
  }

  reserve(effects: readonly SessionEffect[]): boolean {
    const requested = effects.filter(requiresOutcomeCredit);
    const unique = new Set(requested.map(({ correlation }) => correlation.effectId));
    if (unique.size !== requested.length) return false;
    if ([...unique].some((effectId) => this.#effects.has(effectId))) return false;
    if (this.#effects.size + unique.size > MAX_CONCURRENT_EFFECTS) return false;
    for (const effect of requested) this.#effects.set(effect.correlation.effectId, effect);
    return true;
  }

  release(outcome: EffectOutcomeCommand): boolean {
    const effect = this.#effects.get(outcome.correlation.effectId);
    if (
      effect === undefined ||
      !matchesCorrelation(effect, outcome) ||
      !matchesOutcomeFamily(effect, outcome)
    )
      return false;
    this.#effects.delete(outcome.correlation.effectId);
    return true;
  }
}
