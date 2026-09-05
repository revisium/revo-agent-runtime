import { expect, test } from 'vitest';

import type { SessionEffect } from '../../../../../../../src/execution/session/kernel/effect/session-effect.js';
import { reduceSession } from '../../../../../../../src/execution/session/kernel/reducer/reduce.js';
import type { SessionTransition } from '../../../../../../../src/execution/session/kernel/reducer/transition.js';
import { idleSessionState } from '../../../../../../support/session/builders/kernel/session-state.js';

const observed = { observedAt: '2026-03-21T00:00:02.000Z', observedAtMs: 2_000 } as const;
const fault = {
  code: 'revo.agent.event_sink_failed',
  message: 'not durable',
  phase: 'session_delivery',
  retryable: true,
} as const;
const effectOf = <Type extends SessionEffect['type']>(
  transition: SessionTransition,
  type: Type,
): Extract<SessionEffect, { readonly type: Type }> => {
  const effect = transition.effects.find(
    (candidate): candidate is Extract<SessionEffect, { readonly type: Type }> =>
      candidate.type === type,
  );
  if (effect === undefined) throw new Error(`Missing ${type} effect.`);
  return effect;
};
const start = () =>
  reduceSession(idleSessionState(), {
    ...observed,
    call: { callId: 'send_01', epoch: 1, sessionId: 'session_01', turnId: 'turn_01' },
    input: { prompt: 'Continue', turnId: 'turn_01' },
    resultCallId: 'result_01',
    type: 'turn.send',
  });

test.each(['event.failed', 'event.unknown', 'event.timed_out_then_failed'] as const)(
  '%s during turn admission fails closed and releases both public calls',
  (type) => {
    const started = start();
    const transition = reduceSession(started.state, {
      ...observed,
      correlation: effectOf(started, 'event.append').correlation,
      fault,
      type,
    });
    expect(transition.state).toMatchObject({
      events: { pending: [] },
      intent: { outcome: 'failed' },
      lastTurn: { result: { status: 'failed' } },
      progress: { stage: 'cleaning_process' },
      status: 'cancelling',
      timers: [],
    });
    expect(transition.state.events).not.toHaveProperty('inFlight');
    expect(transition.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ callId: 'send_01', type: 'public.reject' }),
        expect.objectContaining({ callId: 'result_01', type: 'public.resolve' }),
        expect.objectContaining({ type: 'process.cleanup' }),
      ]),
    );
  },
);

test('a conflicting turn event fails closed with the canonical conflict fault', () => {
  const started = start();
  const transition = reduceSession(started.state, {
    ...observed,
    correlation: effectOf(started, 'event.append').correlation,
    result: { state: 'conflict' },
    type: 'event.applied',
  });
  expect(transition.state).toMatchObject({
    intent: { error: { code: 'revo.agent.event_conflict' }, outcome: 'failed' },
  });
});

test('a stale delivery failure cannot terminate the active turn', () => {
  const started = start();
  const transition = reduceSession(started.state, {
    ...observed,
    correlation: { ...effectOf(started, 'event.append').correlation, effectId: 'stale' },
    fault,
    type: 'event.failed',
  });
  expect(transition).toEqual({ effects: [], state: started.state });
});
