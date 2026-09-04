import { expect, test } from 'vitest';

import type { SessionEffect } from '../../../../../../src/execution/session/kernel/effect/session-effect.js';
import { reduceSession } from '../../../../../../src/execution/session/kernel/reducer/reduce.js';
import type { SessionTransition } from '../../../../../../src/execution/session/kernel/reducer/transition.js';
import { idleSessionState } from '../../../../../support/session/builders/kernel/session-state.js';

const observedAt = '2026-03-21T00:00:02.000Z';
const observedAtMs = 2_000;
const effectOf = <Type extends SessionEffect['type']>(
  transition: SessionTransition,
  type: Type,
): Extract<SessionEffect, { readonly type: Type }> => {
  const found = transition.effects.find(
    (effect): effect is Extract<SessionEffect, { readonly type: Type }> => effect.type === type,
  );
  if (found === undefined) throw new Error(`Missing ${type} effect.`);
  return found;
};
const outcomeBase = <Correlation extends SessionEffect['correlation']>(effect: {
  readonly correlation: Correlation;
}) => ({
  correlation: effect.correlation,
  observedAt,
  observedAtMs,
});

const startTurn = (): SessionTransition => {
  const state = idleSessionState();
  const sent = reduceSession(state, {
    call: { callId: 'send_01', epoch: 1, sessionId: 'session_01', turnId: 'turn_01' },
    input: { prompt: 'Continue', turnId: 'turn_01' },
    observedAt,
    observedAtMs,
    resultCallId: 'result_01',
    type: 'turn.send',
  });
  expect(sent.state).toMatchObject({ status: 'running', turn: { status: 'starting' } });
  expect(sent.effects.map(({ type }) => type)).toEqual([
    'event.append',
    'timer.cancel',
    'timer.schedule',
  ]);
  const started = effectOf(sent, 'event.append');
  const prompting = reduceSession(sent.state, {
    ...outcomeBase(started),
    result: { state: 'appended' },
    type: 'event.applied',
  });
  expect(prompting.state).toMatchObject({ status: 'running', turn: { status: 'prompting' } });
  expect(prompting.effects.map(({ type }) => type)).toEqual(['provider.prompt', 'public.resolve']);
  return prompting;
};

test('completes an ordinary streamed turn through durable events', () => {
  let transition = startTurn();
  const prompt = effectOf(transition, 'provider.prompt');
  transition = reduceSession(transition.state, {
    ...outcomeBase(prompt),
    type: 'provider.prompt.accepted',
  });
  expect(transition.state).toMatchObject({ status: 'running', turn: { status: 'streaming' } });

  transition = reduceSession(transition.state, {
    content: 'Done',
    correlation: prompt.correlation,
    observedAt,
    observedAtMs,
    type: 'provider.message_delta',
  });
  const delta = effectOf(transition, 'event.append');
  expect(delta.event).toMatchObject({ content: 'Done', type: 'assistant.message.delta' });
  transition = reduceSession(transition.state, {
    ...outcomeBase(prompt),
    outcome: {
      status: 'completed',
      usage: { inputTokens: 2, outputTokens: 1, scope: 'session_cumulative', totalTokens: 3 },
    },
    type: 'provider.prompt.completed',
  });
  expect(transition.state).toMatchObject({ status: 'running', turn: { status: 'settling' } });
  expect(transition.state.events.pending).toHaveLength(1);

  transition = reduceSession(transition.state, {
    ...outcomeBase(delta),
    result: { state: 'appended' },
    type: 'event.applied',
  });
  const completed = effectOf(transition, 'event.append');
  expect(completed.event).toMatchObject({
    outcome: { status: 'completed' },
    type: 'turn.completed',
  });

  transition = reduceSession(transition.state, {
    ...outcomeBase(completed),
    result: { state: 'appended' },
    type: 'event.applied',
  });
  expect(transition.state).toMatchObject({
    lastTurn: { result: { message: { content: 'Done' }, status: 'completed' } },
    status: 'idle',
  });
  expect(effectOf(transition, 'public.resolve')).toMatchObject({
    callId: 'result_01',
    resolution: { kind: 'turn_result', result: { status: 'completed' } },
  });
});

test('ignores a late delta after provider completion', () => {
  let transition = startTurn();
  const prompt = effectOf(transition, 'provider.prompt');
  transition = reduceSession(transition.state, {
    ...outcomeBase(prompt),
    type: 'provider.prompt.accepted',
  });
  transition = reduceSession(transition.state, {
    ...outcomeBase(prompt),
    outcome: { status: 'completed' },
    type: 'provider.prompt.completed',
  });
  const state = transition.state;
  transition = reduceSession(state, {
    content: 'late',
    correlation: prompt.correlation,
    observedAt,
    observedAtMs,
    type: 'provider.message_delta',
  });

  expect(transition).toEqual({ effects: [], state });
});
