import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActiveAgentSessionStateSink } from '../../../../../../src/contracts/session/persistence/active-state.js';
import { createActiveStateInterpreters } from '../../../../../../src/execution/session/interpreter/persistence/active-state.js';
import { recordingSessionEffectOutput } from '../../../../../support/session/interpreter/output.js';

const clock = {
  now: () => ({ iso: '2026-09-05T00:00:01.000Z', milliseconds: 1_000 }),
};

const snapshot = {
  acceptedAt: '2026-09-05T00:00:00.000Z',
  incarnationId: 'incarnation-1',
  pin: { agentId: 'codex', agentVersion: '1.0.0', definitionDigest: 'digest' },
  process: {
    fingerprint: 'process',
    pid: 42,
    processGroupId: 42,
    startedAt: '2026-09-05T00:00:00.000Z',
  },
  sessionId: 'session-1',
  state: 'opening' as const,
};

const effect = {
  correlation: { effectId: 'effect-1', epoch: 1, sessionId: 'session-1' },
  snapshot,
  timeoutMs: 10,
  type: 'persistence.save' as const,
};

describe('active session state outcomes', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each([
    ['initial', 'fulfilled', 'persistence.applied'],
    ['initial', 'rejected', 'persistence.failed'],
    ['late', 'fulfilled', 'persistence.late_applied'],
    ['late', 'rejected', 'persistence.late_failed'],
  ] as const)('maps a %s %s mutation', async (phase, settlement, type) => {
    const pending = Promise.withResolvers<{ readonly state: 'applied' }>();
    const sink: ActiveAgentSessionStateSink = {
      remove: async () => ({ state: 'applied' }),
      save: () => pending.promise,
    };
    const result = recordingSessionEffectOutput();
    createActiveStateInterpreters({ clock, sink }).save.execute(effect, result.output);

    if (phase === 'late') await vi.advanceTimersByTimeAsync(10);
    if (settlement === 'fulfilled') pending.resolve({ state: 'applied' });
    else pending.reject(new Error('private storage failure'));
    await vi.runAllTimersAsync();

    expect(result.outcomes).toEqual([expect.objectContaining({ type })]);
    const outcome = result.outcomes[0];
    if (outcome !== undefined && 'fault' in outcome)
      expect(outcome.fault.message).not.toContain('private storage failure');
  });

  it('reports an unobservable mutation as unknown', async () => {
    const sink: ActiveAgentSessionStateSink = {
      remove: async () => ({ state: 'applied' }),
      save: () => new Promise(() => undefined),
    };
    const result = recordingSessionEffectOutput();
    createActiveStateInterpreters({ clock, sink }).save.execute(effect, result.output);
    await vi.advanceTimersByTimeAsync(20);

    expect(result.outcomes).toEqual([expect.objectContaining({ type: 'persistence.unknown' })]);
  });
});
