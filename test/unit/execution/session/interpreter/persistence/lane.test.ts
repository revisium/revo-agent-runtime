import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActiveAgentSessionStateSink } from '../../../../../../src/contracts/session/persistence/active-state.js';
import { createActiveStateInterpreters } from '../../../../../../src/execution/session/interpreter/persistence/active-state.js';
import { recordingSessionEffectOutput } from '../../../../../support/session/interpreter/output.js';

const clock = {
  now: () => ({ iso: '2026-09-05T00:00:01.000Z', milliseconds: 1_000 }),
};

const correlation = (effectId: string) => ({ effectId, epoch: 1, sessionId: 'session-1' });
const saveEffect = {
  correlation: correlation('save-1'),
  snapshot: {
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
  },
  timeoutMs: 10,
  type: 'persistence.save' as const,
};
const removeEffect = {
  correlation: correlation('remove-1'),
  incarnationId: 'incarnation-1',
  timeoutMs: 10,
  type: 'persistence.remove' as const,
};

describe('serialized active session state lane', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does not let remove overtake an unresolved save', async () => {
    const pendingSave = Promise.withResolvers<{ readonly state: 'applied' }>();
    const remove = vi.fn<ActiveAgentSessionStateSink['remove']>(async () => ({ state: 'applied' }));
    const sink: ActiveAgentSessionStateSink = { remove, save: () => pendingSave.promise };
    const result = recordingSessionEffectOutput();
    const interpreters = createActiveStateInterpreters({ clock, sink });

    interpreters.save.execute(saveEffect, result.output);
    interpreters.remove.execute(removeEffect, result.output);
    await vi.advanceTimersByTimeAsync(20);
    expect(remove).not.toHaveBeenCalled();
    expect(result.outcomes).toContainEqual(
      expect.objectContaining({ type: 'persistence.unknown' }),
    );

    pendingSave.resolve({ state: 'applied' });
    await vi.runAllTimersAsync();
    expect(remove).toHaveBeenCalledOnce();
    expect(result.outcomes).toContainEqual(
      expect.objectContaining({ type: 'persistence.applied' }),
    );
  });

  it('gates later saves and coalesces an acknowledged duplicate removal', async () => {
    const save = vi.fn<ActiveAgentSessionStateSink['save']>(async () => ({ state: 'applied' }));
    const remove = vi.fn<ActiveAgentSessionStateSink['remove']>(async () => ({ state: 'applied' }));
    const result = recordingSessionEffectOutput();
    const interpreters = createActiveStateInterpreters({ clock, sink: { remove, save } });

    interpreters.remove.execute(removeEffect, result.output);
    await vi.runAllTimersAsync();
    interpreters.save.execute({ ...saveEffect, correlation: correlation('save-2') }, result.output);
    interpreters.remove.execute(
      { ...removeEffect, correlation: correlation('remove-2') },
      result.output,
    );
    await vi.runAllTimersAsync();

    expect(save).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledOnce();
    expect(result.outcomes.map(({ type }) => type)).toEqual([
      'persistence.applied',
      'persistence.failed',
      'persistence.applied',
    ]);
  });
});
