import { expect, test } from 'vitest';

import type { SessionEffect } from '../../../../../../../src/execution/session/kernel/effect/session-effect.js';
import { reduceSession } from '../../../../../../../src/execution/session/kernel/reducer/reduce.js';
import type { SessionTransition } from '../../../../../../../src/execution/session/kernel/reducer/transition.js';
import { idleSessionState } from '../../../../../../support/session/builders/kernel/session-state.js';

const observedAt = '2026-03-21T00:00:02.000Z';
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
    observedAt,
    observedAtMs: 2_000,
    resultCallId: 'result_01',
    type: 'turn.send',
  });
  const append = effectOf(sent, 'event.append');
  const prompting = reduceSession(sent.state, {
    correlation: append.correlation,
    observedAt,
    observedAtMs: 2_001,
    result: { state: 'appended' },
    type: 'event.applied',
  });
  return { prompt: effectOf(prompting, 'provider.prompt'), state: prompting.state };
};

test('turn cancellation wins when admitted before natural completion', () => {
  const { prompt, state } = promptingTurn();
  let transition = reduceSession(state, {
    call: { callId: 'cancel_01', epoch: 1, sessionId: 'session_01', turnId: 'turn_01' },
    observedAt,
    observedAtMs: 2_002,
    turnId: 'turn_01',
    type: 'turn.cancel',
  });
  expect(transition.state).toMatchObject({
    status: 'running',
    turn: { progress: { outcome: { status: 'cancelled' }, stage: 'awaiting_provider' } },
  });
  expect(effectOf(transition, 'public.resolve')).toMatchObject({
    callId: 'cancel_01',
    resolution: { kind: 'cancel_turn', result: { state: 'requested' } },
  });
  expect(effectOf(transition, 'provider.turn.cancel')).toMatchObject({ turnId: 'turn_01' });

  transition = reduceSession(transition.state, {
    correlation: prompt.correlation,
    observedAt,
    observedAtMs: 2_003,
    outcome: { status: 'completed' },
    type: 'provider.prompt.completed',
  });
  expect(effectOf(transition, 'event.append').event).toMatchObject({
    outcome: { status: 'cancelled' },
    type: 'turn.completed',
  });
});

test('natural completion wins when observed before turn cancellation', () => {
  const { prompt, state } = promptingTurn();
  const completed = reduceSession(state, {
    correlation: prompt.correlation,
    observedAt,
    observedAtMs: 2_002,
    outcome: { status: 'completed' },
    type: 'provider.prompt.completed',
  });
  const cancelled = reduceSession(completed.state, {
    call: { callId: 'cancel_01', epoch: 1, sessionId: 'session_01', turnId: 'turn_01' },
    observedAt,
    observedAtMs: 2_003,
    turnId: 'turn_01',
    type: 'turn.cancel',
  });
  expect(effectOf(cancelled, 'public.resolve')).toMatchObject({
    resolution: { kind: 'cancel_turn', result: { state: 'already_completed' } },
  });
  expect(cancelled.effects).not.toContainEqual(
    expect.objectContaining({ type: 'provider.turn.cancel' }),
  );
});

test('rejects a second turn and graceful close while a turn is active', () => {
  const { state } = promptingTurn();
  const second = reduceSession(state, {
    call: { callId: 'send_02', epoch: 1, sessionId: 'session_01', turnId: 'turn_02' },
    input: { prompt: 'Again', turnId: 'turn_02' },
    observedAt,
    observedAtMs: 2_004,
    resultCallId: 'result_02',
    type: 'turn.send',
  });
  expect(effectOf(second, 'public.reject')).toMatchObject({
    callId: 'send_02',
    fault: { code: 'revo.agent.session_busy' },
  });
  const closed = reduceSession(state, {
    call: { callId: 'close_01', epoch: 1, sessionId: 'session_01' },
    observedAt,
    observedAtMs: 2_004,
    type: 'session.close',
  });
  expect(effectOf(closed, 'public.reject')).toMatchObject({
    callId: 'close_01',
    fault: { code: 'revo.agent.session_busy' },
  });
});
