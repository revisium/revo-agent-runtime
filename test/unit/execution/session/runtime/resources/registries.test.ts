import { describe, expect, test } from 'vitest';

import { ProviderPromptRegistry } from '../../../../../../src/execution/session/interpreter/provider/prompts.js';
import { ProviderOpeningRegistry } from '../../../../../../src/execution/session/runtime/resources/provider-openings.js';
import { ProviderSessionRegistry } from '../../../../../../src/execution/session/runtime/resources/provider-sessions.js';

describe('provider resource registries', () => {
  test('promotes one correlated opening into the hot-session registry', () => {
    const openings = new ProviderOpeningRegistry<object>();
    const sessions = new ProviderSessionRegistry<object>();
    const resource = Object.freeze({ connection: 'provider' });

    expect(openings.register('effect_01', 'resource_01', resource)).toBe(true);
    expect(openings.get('resource_01')).toBe(resource);
    expect(openings.register('effect_01', 'resource_02', {})).toBe(false);
    expect(openings.promote('effect_01', 'resource_01', sessions)).toBe(true);

    expect(openings.size).toBe(0);
    expect(sessions.get('resource_01')).toBe(resource);
    expect(sessions.size).toBe(1);
  });

  test('keeps mismatched and late resources available for explicit cleanup', () => {
    const openings = new ProviderOpeningRegistry<object>();
    const sessions = new ProviderSessionRegistry<object>();
    const resource = Object.freeze({ connection: 'late' });
    openings.register('effect_01', 'resource_01', resource);

    expect(openings.promote('effect_01', 'wrong_resource', sessions)).toBe(false);
    expect(openings.take('effect_01', 'resource_01')).toBe(resource);
    expect(openings.take('effect_01', 'resource_01')).toBeUndefined();
    expect(sessions.size).toBe(0);
  });

  test('finds an opening after scanning a different resource identity', () => {
    const openings = new ProviderOpeningRegistry<object>();
    const first = { connection: 'first' };
    const second = { connection: 'second' };
    openings.register('effect_01', 'resource_01', first);
    openings.register('effect_02', 'resource_02', second);
    expect(openings.get('resource_02')).toBe(second);
  });

  test('rejects duplicate resource identity and restores an opening after promotion collision', () => {
    const openings = new ProviderOpeningRegistry<object>();
    const sessions = new ProviderSessionRegistry<object>();
    const resource = Object.freeze({ connection: 'provider' });
    const existing = Object.freeze({ connection: 'existing' });
    openings.register('effect_01', 'resource_01', resource);
    expect(openings.register('effect_02', 'resource_01', {})).toBe(false);
    sessions.register('resource_01', existing);

    expect(openings.promote('effect_01', 'resource_01', sessions)).toBe(false);
    expect(openings.get('resource_01')).toBe(resource);
    expect(openings.takeByResourceId('missing')).toBeUndefined();
    expect(openings.takeByResourceId('resource_01')).toBe(resource);
  });

  test('removes a hot resource exactly once', () => {
    const sessions = new ProviderSessionRegistry<object>();
    const resource = Object.freeze({ connection: 'provider' });

    expect(sessions.register('resource_01', resource)).toBe(true);
    expect(sessions.register('resource_01', {})).toBe(false);
    expect(sessions.take('resource_01')).toBe(resource);
    expect(sessions.take('resource_01')).toBeUndefined();
  });

  test('tracks prompt ownership, cancellation, correlated take, and provider cleanup', () => {
    const prompts = new ProviderPromptRegistry();
    const prompt = {
      cancel: async () => ({ status: 'requested' as const }),
      completion: new Promise<never>(() => undefined),
    };
    expect(prompts.register('provider', 'turn-1', { effectId: 'effect-1', prompt })).toBe(true);
    expect(prompts.register('provider', 'turn-1', { effectId: 'duplicate', prompt })).toBe(false);
    expect(prompts.get('provider', 'turn-1')).toMatchObject({ cancellationRequested: false });
    expect(prompts.markCancelling('missing', 'turn')).toBeUndefined();
    expect(prompts.markCancelling('provider', 'turn-1')).toMatchObject({
      cancellationRequested: true,
    });
    expect(prompts.take('provider', 'turn-1', 'wrong')).toBeUndefined();
    expect(prompts.take('provider', 'turn-1', 'effect-1')).toMatchObject({ effectId: 'effect-1' });
    expect(prompts.take('provider', 'turn-1', 'effect-1')).toBeUndefined();

    prompts.register('provider', 'turn-2', { effectId: 'effect-2', prompt });
    prompts.register('other', 'turn-3', { effectId: 'effect-3', prompt });
    expect(prompts.takeProvider('provider')).toHaveLength(1);
    expect(prompts.takeProvider('provider')).toEqual([]);
    expect(prompts.get('other', 'turn-3')).toBeDefined();
  });
});
