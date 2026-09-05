import { describe, expect, test } from 'vitest';

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

  test('removes a hot resource exactly once', () => {
    const sessions = new ProviderSessionRegistry<object>();
    const resource = Object.freeze({ connection: 'provider' });

    expect(sessions.register('resource_01', resource)).toBe(true);
    expect(sessions.register('resource_01', {})).toBe(false);
    expect(sessions.take('resource_01')).toBe(resource);
    expect(sessions.take('resource_01')).toBeUndefined();
  });
});
