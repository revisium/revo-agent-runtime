import { describe, expect, test } from 'vitest';

import type { AgentSessionEvent } from '../../../../../../src/contracts/session/events/event.js';
import type { PublicSessionCommand } from '../../../../../../src/execution/session/kernel/command/public.js';
import type { SessionState } from '../../../../../../src/execution/session/kernel/model/session-state.js';
import type { SessionReducer } from '../../../../../../src/execution/session/kernel/reducer/transition.js';
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

const observed = { observedAt: '2026-09-05T00:00:00.000Z', observedAtMs: 1_000 } as const;
const clock: SessionClock = {
  now: () => ({ iso: observed.observedAt, milliseconds: observed.observedAtMs }),
  schedule: () => ({ cancel: () => undefined }),
};
const promptCorrelation = {
  effectId: 'prompt_01',
  epoch: 1,
  sessionId: 'session_01',
  turnId: 'turn_01',
} as const;
const seed: PublicSessionCommand = {
  ...observed,
  call: { callId: 'seed', epoch: 1, sessionId: 'session_01' },
  type: 'session.close',
};

const progressEvent = (state: SessionState, content: string): AgentSessionEvent => ({
  eventId: `event_${state.nextEventSequence}`,
  message: content,
  observedAt: observed.observedAt,
  schemaVersion: 'agent-session-event/v1',
  sequence: state.nextEventSequence,
  sessionId: state.sessionId,
  streamId: state.streamId,
  turnId: 'turn_01',
  type: 'agent.progress',
});

const appendProgress = (state: SessionState, content: string): ReturnType<SessionReducer> => {
  const event = progressEvent(state, content);
  if (state.events.inFlight !== undefined)
    return {
      effects: [],
      state: {
        ...state,
        events: { ...state.events, pending: [...state.events.pending, event] },
        nextEventSequence: state.nextEventSequence + 1,
      },
    };
  const correlation = {
    effectId: `event_effect_${state.nextEffectSequence}`,
    epoch: state.epoch,
    sessionId: state.sessionId,
  };
  const expected =
    state.events.cursor === undefined
      ? ({ kind: 'empty' } as const)
      : ({ cursor: state.events.cursor, kind: 'cursor' } as const);
  return {
    effects: [
      {
        correlation,
        event,
        expected,
        timeoutMs: 100,
        type: 'event.append',
      },
    ],
    state: {
      ...state,
      events: { ...state.events, inFlight: { correlation, event } },
      nextEffectSequence: state.nextEffectSequence + 1,
      nextEventSequence: state.nextEventSequence + 1,
    },
  };
};

const acknowledgeEvent = (state: SessionState): ReturnType<SessionReducer> => {
  const inFlight = state.events.inFlight;
  if (inFlight === undefined) return { effects: [], state };
  const [next, ...pending] = state.events.pending;
  const cursor = {
    eventId: inFlight.event.eventId,
    sequence: inFlight.event.sequence,
    streamId: inFlight.event.streamId,
  };
  if (next === undefined)
    return { effects: [], state: { ...state, events: { cursor, pending: [] } } };
  const correlation = {
    effectId: `event_effect_${state.nextEffectSequence}`,
    epoch: state.epoch,
    sessionId: state.sessionId,
  };
  return {
    effects: [
      {
        correlation,
        event: next,
        expected: { cursor, kind: 'cursor' },
        timeoutMs: 100,
        type: 'event.append',
      },
    ],
    state: {
      ...state,
      events: { cursor, inFlight: { correlation, event: next }, pending },
      nextEffectSequence: state.nextEffectSequence + 1,
    },
  };
};

describe('provider ingress flow control', () => {
  test('a fast cooperative provider stops at the bounded outbox until the sink advances', async () => {
    const delivered: string[] = [];
    let maximumPending = 0;
    const reducer: SessionReducer = (state, command) => {
      if (command.type === 'session.close')
        return {
          effects: [
            {
              correlation: promptCorrelation,
              input: { prompt: 'stream', turnId: 'turn_01' },
              providerResourceId: 'provider_01',
              timeoutMs: 100,
              type: 'provider.prompt',
            },
          ],
          state,
        };
      if (command.type === 'provider.message_delta') {
        delivered.push(command.content);
        const transition = appendProgress(state, command.content);
        maximumPending = Math.max(maximumPending, transition.state.events.pending.length);
        return transition;
      }
      if (command.type === 'event.applied') return acknowledgeEvent(state);
      return { effects: [], state };
    };
    const pendingAppends: Array<() => void> = [];
    let produced = 0;
    let producer: Promise<void> | undefined;
    const prompt = {
      execute: (effect, output) => {
        if (effect.type !== 'provider.prompt') throw new Error('Expected provider prompt.');
        producer = repeatAsync(200, async (index) => {
          await output.update({
            ...observed,
            content: String(index),
            correlation: effect.correlation,
            type: 'provider.message_delta',
          });
          produced += 1;
        }).then(() => {
          output.outcome({
            ...observed,
            correlation: effect.correlation,
            outcome: { status: 'cancelled' },
            type: 'provider.prompt.completed',
          });
        });
      },
      type: 'provider.prompt',
    } satisfies SessionEffectInterpreter;
    const events = {
      execute: (effect, output) =>
        pendingAppends.push(() =>
          output.outcome({
            ...observed,
            correlation: effect.correlation,
            result: { state: 'appended' },
            type: 'event.applied',
          }),
        ),
      type: 'event.append',
    } satisfies SessionEffectInterpreter;
    const actor = new SessionActor({
      clock,
      dispatcher: new SessionEffectDispatcher([prompt, events]),
      initialState: idleSessionState(),
      reducer,
    });

    actor.dispatch(seed);
    await flushMicrotasks(400);

    expect(actor.state.events.pending).toHaveLength(MAX_QUEUED_EVENTS);
    expect(produced).toBe(MAX_QUEUED_EVENTS);

    await repeatUntil(400, async () => {
      pendingAppends.shift()?.();
      await Promise.resolve();
      return produced === 200 && actor.state.events.inFlight === undefined;
    });
    await producer;
    await actor.whenQuiescent();

    expect(delivered).toEqual(Array.from({ length: 200 }, (_, index) => String(index)));
    expect(maximumPending).toBe(MAX_QUEUED_EVENTS);
    expect(actor.state.events.pending).toHaveLength(0);
    expect(actor.activeEffects).toBe(0);
  });
});
