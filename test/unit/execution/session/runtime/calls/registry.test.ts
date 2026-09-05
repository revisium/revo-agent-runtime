import { describe, expect, test } from 'vitest';

import { PublicCallRegistry } from '../../../../../../src/execution/session/runtime/calls/registry.js';

const fault = {
  code: 'revo.agent.session_backpressure',
  message: 'The session mailbox is full.',
  phase: 'session_running',
  retryable: true,
} as const;

describe('public call registry', () => {
  test('correlates out-of-order settlements without exposing mutable entries', async () => {
    const registry = new PublicCallRegistry();
    const first = registry.register('call_01');
    const second = registry.register('call_02');

    expect(registry.resolve('call_02', { kind: 'session_ready' })).toBe(true);
    expect(registry.reject('call_01', fault)).toBe(true);

    await expect(first).resolves.toEqual({ fault, state: 'rejected' });
    await expect(second).resolves.toEqual({
      resolution: { kind: 'session_ready' },
      state: 'resolved',
    });
    expect(registry.size).toBe(0);
  });

  test('settles a coalesced follower with its control leader', async () => {
    const registry = new PublicCallRegistry();
    const leader = registry.register('leader');
    const follower = registry.register('follower');

    expect(registry.alias('follower', 'leader')).toBe(true);
    expect(registry.resolve('leader', { kind: 'shutdown_complete' })).toBe(true);

    await expect(leader).resolves.toEqual({
      resolution: { kind: 'shutdown_complete' },
      state: 'resolved',
    });
    await expect(follower).resolves.toEqual({
      resolution: { kind: 'shutdown_complete' },
      state: 'resolved',
    });
    expect(registry.size).toBe(0);
  });

  test('ignores unknown and repeated settlements', () => {
    const registry = new PublicCallRegistry();
    void registry.register('call_01');

    expect(registry.resolve('unknown', { kind: 'session_ready' })).toBe(false);
    expect(registry.resolve('call_01', { kind: 'session_ready' })).toBe(true);
    expect(registry.reject('call_01', fault)).toBe(false);
  });

  test('reports quiescence only after all registered calls settle', async () => {
    const registry = new PublicCallRegistry();
    void registry.register('call_01');
    let empty = false;
    void registry.whenEmpty().then(() => (empty = true));

    await Promise.resolve();
    expect(empty).toBe(false);
    registry.resolve('call_01', { kind: 'session_ready' });
    await registry.whenEmpty();

    expect(empty).toBe(true);
  });
});
