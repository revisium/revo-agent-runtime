import { expect, test } from 'vitest';

import type { SessionEffect } from '../../../../../../../src/execution/session/kernel/effect/session-effect.js';
import { reduceSession } from '../../../../../../../src/execution/session/kernel/reducer/reduce.js';
import type { SessionTransition } from '../../../../../../../src/execution/session/kernel/reducer/transition.js';
import { idleSessionState } from '../../../../../../support/session/builders/kernel/session-state.js';

const at = '2026-03-21T00:00:02.000Z';
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

const promptingTurn = () => {
  const sent = reduceSession(idleSessionState(), {
    call: { callId: 'send_01', epoch: 1, sessionId: 'session_01', turnId: 'turn_01' },
    input: { prompt: 'Continue', turnId: 'turn_01' },
    observedAt: at,
    observedAtMs: 2_000,
    resultCallId: 'result_01',
    type: 'turn.send',
  });
  const append = effectOf(sent, 'event.append');
  const prompting = reduceSession(sent.state, {
    correlation: append.correlation,
    observedAt: at,
    observedAtMs: 2_001,
    result: { state: 'appended' },
    type: 'event.applied',
  });
  return { prompt: effectOf(prompting, 'provider.prompt'), state: prompting.state };
};

test('session cancellation wins before natural turn completion', () => {
  const { prompt, state } = promptingTurn();
  let transition = reduceSession(state, {
    call: { callId: 'cancel_01', epoch: 1, sessionId: 'session_01' },
    observedAt: at,
    observedAtMs: 2_002,
    type: 'session.cancel',
  });
  expect(transition.state).toMatchObject({
    progress: {
      stage: 'settling_turn',
      turn: { progress: { outcome: { status: 'interrupted' }, stage: 'awaiting_provider' } },
    },
    status: 'cancelling',
    timers: [],
  });
  expect(effectOf(transition, 'public.resolve')).toMatchObject({
    resolution: { kind: 'cancel_session', result: { state: 'requested' } },
  });

  transition = reduceSession(transition.state, {
    correlation: prompt.correlation,
    observedAt: at,
    observedAtMs: 2_003,
    outcome: { status: 'completed' },
    type: 'provider.prompt.completed',
  });
  expect(effectOf(transition, 'event.append').event).toMatchObject({
    outcome: { status: 'interrupted' },
    type: 'turn.completed',
  });
  const completion = effectOf(transition, 'event.append');
  transition = reduceSession(transition.state, {
    correlation: completion.correlation,
    observedAt: at,
    observedAtMs: 2_004,
    result: { state: 'appended' },
    type: 'event.applied',
  });
  expect(transition.state).toMatchObject({
    lastTurn: { result: { status: 'interrupted' } },
    progress: { stage: 'cleaning_process' },
  });
  expect(effectOf(transition, 'public.resolve')).toMatchObject({
    callId: 'result_01',
    resolution: { kind: 'turn_result', result: { status: 'interrupted' } },
  });
  expect(effectOf(transition, 'process.cleanup')).toBeDefined();
});

test('natural turn completion wins before session cancellation', () => {
  const { prompt, state } = promptingTurn();
  const completed = reduceSession(state, {
    correlation: prompt.correlation,
    observedAt: at,
    observedAtMs: 2_002,
    outcome: { status: 'completed' },
    type: 'provider.prompt.completed',
  });
  const cancelled = reduceSession(completed.state, {
    call: { callId: 'cancel_01', epoch: 1, sessionId: 'session_01' },
    observedAt: at,
    observedAtMs: 2_003,
    type: 'session.cancel',
  });
  expect(cancelled.state).toMatchObject({
    progress: {
      stage: 'settling_turn',
      turn: { progress: { outcome: { status: 'completed' } } },
    },
    status: 'cancelling',
  });
  expect(cancelled.effects).not.toContainEqual(
    expect.objectContaining({ type: 'provider.turn.cancel' }),
  );
  const completion = effectOf(completed, 'event.append');
  const cleaning = reduceSession(cancelled.state, {
    correlation: completion.correlation,
    observedAt: at,
    observedAtMs: 2_004,
    result: { state: 'appended' },
    type: 'event.applied',
  });
  expect(cleaning.state).toMatchObject({
    lastTurn: { result: { status: 'completed' } },
    progress: { stage: 'cleaning_process' },
  });
});

test('session cancellation during durable turn admission settles the admitted turn', () => {
  const sent = reduceSession(idleSessionState(), {
    call: { callId: 'send_01', epoch: 1, sessionId: 'session_01', turnId: 'turn_01' },
    input: { prompt: 'Continue', turnId: 'turn_01' },
    observedAt: at,
    observedAtMs: 2_000,
    resultCallId: 'result_01',
    type: 'turn.send',
  });
  const cancelled = reduceSession(sent.state, {
    call: { callId: 'cancel_01', epoch: 1, sessionId: 'session_01' },
    observedAt: at,
    observedAtMs: 2_001,
    type: 'session.cancel',
  });
  const event = effectOf(sent, 'event.append');
  const settling = reduceSession(cancelled.state, {
    correlation: event.correlation,
    observedAt: at,
    observedAtMs: 2_002,
    result: { state: 'appended' },
    type: 'event.applied',
  });
  expect(settling.state).toMatchObject({
    progress: {
      stage: 'settling_turn',
      turn: { progress: { outcome: { status: 'interrupted' } } },
    },
  });
  expect(settling.effects.map(({ type }) => type)).toEqual([
    'provider.prompt',
    'public.resolve',
    'provider.turn.cancel',
  ]);
});
