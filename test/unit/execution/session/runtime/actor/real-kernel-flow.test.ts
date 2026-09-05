import { describe, expect, test } from 'vitest';

import { reduceSession } from '../../../../../../src/execution/session/kernel/reducer/reduce.js';
import { SessionActor } from '../../../../../../src/execution/session/runtime/actor/session-actor.js';
import {
  SessionEffectDispatcher,
  type SessionEffectInterpreter,
} from '../../../../../../src/execution/session/runtime/effects/dispatcher.js';
import { MAX_QUEUED_EVENTS } from '../../../../../../src/execution/session/runtime/mailbox/credits.js';
import type { SessionClock } from '../../../../../../src/execution/session/runtime/timing/clock.js';
import { idleSessionState } from '../../../../../support/session/builders/kernel/session-state.js';
import {
  flushMicrotasks,
  repeatAsync,
  repeatUntil,
} from '../../../../../support/session/runtime/scheduling/async-steps.js';

const observed = { observedAt: '2026-09-05T00:00:00.000Z', observedAtMs: 2_000 } as const;
const clock: SessionClock = {
  now: () => ({ iso: observed.observedAt, milliseconds: observed.observedAtMs }),
  schedule: () => ({ cancel: () => undefined }),
};

describe('real kernel provider flow control', () => {
  test('keeps the real event outbox bounded and completes all ordered updates', async () => {
    const pendingAppends: Array<() => void> = [];
    const delivered: string[] = [];
    let produced = 0;
    let producer: Promise<void> | undefined;
    let maximumPending = 0;
    let actor: SessionActor;
    const events = {
      execute: (effect, output) => {
        if (effect.type !== 'event.append') throw new Error('Expected event append.');
        const apply = (): void =>
          output.outcome({
            ...observed,
            correlation: effect.correlation,
            result: { state: 'appended' },
            type: 'event.applied',
          });
        if (effect.event.type === 'turn.started') apply();
        else pendingAppends.push(apply);
      },
      type: 'event.append',
    } satisfies SessionEffectInterpreter;
    const prompt = {
      execute: (effect, output) => {
        if (effect.type !== 'provider.prompt') throw new Error('Expected provider prompt.');
        output.outcome({
          ...observed,
          correlation: effect.correlation,
          type: 'provider.prompt.accepted',
        });
        producer = repeatAsync(200, async (index) => {
          const content = `${index},`;
          await output.update({
            ...observed,
            content,
            correlation: effect.correlation,
            type: 'provider.message_delta',
          });
          delivered.push(content);
          produced += 1;
          maximumPending = Math.max(maximumPending, actor.state.events.pending.length);
        }).then(() => {
          output.outcome({
            ...observed,
            correlation: effect.correlation,
            outcome: { status: 'completed' },
            type: 'provider.prompt.completed',
          });
        });
      },
      type: 'provider.prompt',
    } satisfies SessionEffectInterpreter;
    actor = new SessionActor({
      clock,
      dispatcher: new SessionEffectDispatcher([events, prompt]),
      initialState: idleSessionState(),
      reducer: reduceSession,
    });
    const ready = actor.registerCall('send_01');
    const result = actor.registerCall('result_01');

    actor.dispatch({
      ...observed,
      call: { callId: 'send_01', epoch: 1, sessionId: 'session_01', turnId: 'turn_01' },
      input: { prompt: 'Stream', turnId: 'turn_01' },
      resultCallId: 'result_01',
      type: 'turn.send',
    });
    await ready;
    await flushMicrotasks(400);

    maximumPending = Math.max(maximumPending, actor.state.events.pending.length);
    expect(actor.state.events.pending).toHaveLength(MAX_QUEUED_EVENTS);
    expect(produced).toBe(MAX_QUEUED_EVENTS);

    await repeatUntil(500, async () => {
      pendingAppends.shift()?.();
      await Promise.resolve();
      maximumPending = Math.max(maximumPending, actor.state.events.pending.length);
      return produced === 200 && actor.state.status === 'idle';
    });
    await producer;
    await expect(result).resolves.toMatchObject({
      resolution: { kind: 'turn_result', result: { status: 'completed' } },
      state: 'resolved',
    });
    await actor.whenQuiescent();

    expect(delivered).toEqual(Array.from({ length: 200 }, (_, index) => `${index},`));
    expect(maximumPending).toBe(MAX_QUEUED_EVENTS);
    expect(actor.state.events.pending).toHaveLength(0);
    expect(actor.state.status).toBe('idle');
    expect(actor.activeEffects).toBe(0);
  });
});
