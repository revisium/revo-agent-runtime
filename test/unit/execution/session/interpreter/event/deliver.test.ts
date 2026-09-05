import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentSessionEventSink } from '../../../../../../src/contracts/session/events/sink.js';
import { createEventAppendInterpreter } from '../../../../../../src/execution/session/interpreter/event/deliver.js';
import type { SessionEffectOutput } from '../../../../../../src/execution/session/runtime/effects/outcomes.js';

const event = {
  eventId: 'event-1',
  observedAt: '2026-09-05T00:00:00.000Z',
  outcome: 'closed' as const,
  schemaVersion: 'agent-session-event/v1' as const,
  sequence: 1,
  sessionId: 'session-1',
  streamId: 'stream-1',
  type: 'session.closed' as const,
};

const effect = {
  correlation: { effectId: 'effect-1', epoch: 1, sessionId: 'session-1' },
  event,
  expected: { kind: 'empty' as const },
  maxBytes: 2_048,
  timeoutMs: 10,
  type: 'event.append' as const,
};

const clock = {
  now: () => ({ iso: '2026-09-05T00:00:01.000Z', milliseconds: 1_000 }),
};

const output = () => {
  const outcomes: Parameters<SessionEffectOutput['outcome']>[0][] = [];
  const port: SessionEffectOutput = {
    offerUpdate: () => 'accepted',
    outcome: (value) => void outcomes.push(value),
    update: async () => 'processed',
  };
  return { outcomes, port };
};

describe('session event delivery', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('delivers an owned event and reports the sink result', async () => {
    const append = vi.fn<AgentSessionEventSink['append']>(async () => ({ state: 'appended' }));
    const result = output();
    createEventAppendInterpreter({ clock, sink: { append } }).execute(effect, result.port);
    await vi.runAllTimersAsync();

    expect(append).toHaveBeenCalledOnce();
    const call = append.mock.calls[0]!;
    expect(call[0].eventId).toBe('event-1');
    expect(call[1].expected).toEqual({ kind: 'empty' });
    expect(call[1].signal).toBeInstanceOf(AbortSignal);
    expect(Object.isFrozen(call[0])).toBe(true);
    expect(result.outcomes).toEqual([
      expect.objectContaining({ result: { state: 'appended' }, type: 'event.applied' }),
    ]);
  });

  it('reports a sink rejection without leaking its exception', async () => {
    const result = output();
    const sink: AgentSessionEventSink = { append: async () => Promise.reject(new Error('secret')) };
    createEventAppendInterpreter({ clock, sink }).execute(effect, result.port);
    await vi.runAllTimersAsync();

    const outcome = result.outcomes[0];
    expect(outcome?.type).toBe('event.failed');
    if (outcome?.type !== 'event.failed') throw new Error('Expected event failure');
    expect(outcome.fault.message).not.toContain('secret');
  });

  it('contains a synchronous sink exception', async () => {
    const result = output();
    const sink: AgentSessionEventSink = {
      append: () => {
        throw new Error('secret synchronous failure');
      },
    };
    createEventAppendInterpreter({ clock, sink }).execute(effect, result.port);
    await vi.runAllTimersAsync();

    expect(result.outcomes).toEqual([expect.objectContaining({ type: 'event.failed' })]);
  });

  it('ignores an effect owned by another interpreter', async () => {
    const append = vi.fn<AgentSessionEventSink['append']>();
    const result = output();
    createEventAppendInterpreter({ clock, sink: { append } }).execute(
      { ...effect, type: 'process.cleanup' } as never,
      result.port,
    );
    await vi.runAllTimersAsync();
    expect(append).not.toHaveBeenCalled();
    expect(result.outcomes).toEqual([]);
  });

  it.each([
    ['fulfilled', 'event.timed_out_then_applied'],
    ['rejected', 'event.timed_out_then_failed'],
  ] as const)('classifies a late %s settlement', async (settlement, type) => {
    const pending = Promise.withResolvers<{ readonly state: 'appended' }>();
    const result = output();
    const sink: AgentSessionEventSink = { append: () => pending.promise };
    createEventAppendInterpreter({ clock, sink }).execute(effect, result.port);

    await vi.advanceTimersByTimeAsync(10);
    if (settlement === 'fulfilled') pending.resolve({ state: 'appended' });
    else pending.reject(new Error('late'));
    await vi.runAllTimersAsync();

    expect(result.outcomes).toEqual([expect.objectContaining({ type })]);
  });

  it('classifies a non-cooperative sink as unknown and aborts it', async () => {
    let signal: AbortSignal | undefined;
    const result = output();
    const sink: AgentSessionEventSink = {
      append: (_event, context) => {
        signal = context.signal;
        return new Promise(() => undefined);
      },
    };
    createEventAppendInterpreter({ clock, sink }).execute(effect, result.port);
    await vi.advanceTimersByTimeAsync(20);

    expect(signal?.aborted).toBe(true);
    expect(result.outcomes).toEqual([expect.objectContaining({ type: 'event.unknown' })]);
  });
});
