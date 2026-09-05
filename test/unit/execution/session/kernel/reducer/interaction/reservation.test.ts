import { expect, test } from 'vitest';

import type { SessionEffect } from '../../../../../../../src/execution/session/kernel/effect/session-effect.js';
import { reduceSession } from '../../../../../../../src/execution/session/kernel/reducer/reduce.js';
import type { SessionTransition } from '../../../../../../../src/execution/session/kernel/reducer/transition.js';
import { streamingSessionState } from '../../../../../../support/session/builders/kernel/running.js';

const observed = { observedAt: '2026-03-21T00:00:02.000Z', observedAtMs: 2_000 } as const;
const permission = {
  action: { kind: 'execute' },
  kind: 'permission',
  options: [{ kind: 'allow_once', label: 'Allow', optionId: 'allow' }],
  requestId: 'permission_01',
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

test('reserves a reentrant response until the request event is durable', () => {
  const initial = streamingSessionState();
  let transition = reduceSession(initial, {
    ...observed,
    correlation: initial.turn.correlation,
    providerResourceId: 'provider_01',
    request: permission,
    scope: { kind: 'turn', turnId: 'turn_01' },
    type: 'provider.interaction_requested',
  });

  expect(transition.state).toMatchObject({
    interactions: [{ request: permission, stage: 'publishing' }],
    turn: { status: 'awaiting_interaction' },
  });
  const requested = effectOf(transition, 'event.append');
  expect(requested.event).toMatchObject({ request: permission, type: 'interaction.requested' });

  transition = reduceSession(transition.state, {
    ...observed,
    call: { callId: 'respond_01', epoch: 1, sessionId: 'session_01' },
    input: {
      requestId: 'permission_01',
      response: { kind: 'permission', optionId: 'allow', outcome: 'selected' },
    },
    type: 'interaction.respond',
  });

  expect(transition.state.interactions).toMatchObject([
    { delivery: { stage: 'publishing' }, stage: 'responding' },
  ]);
  expect(transition.effects.map(({ type }) => type)).toEqual(['public.resolve']);
  expect(effectOf(transition, 'public.resolve')).toMatchObject({
    callId: 'respond_01',
    resolution: { kind: 'interaction', result: { state: 'accepted' } },
  });

  transition = reduceSession(transition.state, {
    ...observed,
    correlation: requested.correlation,
    result: { state: 'appended' },
    type: 'event.applied',
  });

  expect(transition.effects.map(({ type }) => type)).toEqual([
    'timer.cancel',
    'provider.interaction.respond',
  ]);
  expect(effectOf(transition, 'provider.interaction.respond')).toMatchObject({
    request: permission,
    response: { kind: 'permission', optionId: 'allow', outcome: 'selected' },
  });
});

test('delivers, resolves, and idempotently remembers a published response', () => {
  const initial = streamingSessionState();
  let transition = reduceSession(initial, {
    ...observed,
    correlation: initial.turn.correlation,
    providerResourceId: 'provider_01',
    request: permission,
    scope: { kind: 'turn', turnId: 'turn_01' },
    type: 'provider.interaction_requested',
  });
  const requested = effectOf(transition, 'event.append');
  transition = reduceSession(transition.state, {
    ...observed,
    correlation: requested.correlation,
    result: { state: 'appended' },
    type: 'event.applied',
  });
  expect(transition.state.interactions).toMatchObject([{ stage: 'ready' }]);

  transition = reduceSession(transition.state, {
    ...observed,
    call: { callId: 'respond_01', epoch: 1, sessionId: 'session_01' },
    input: {
      requestId: 'permission_01',
      response: { kind: 'permission', optionId: 'allow', outcome: 'selected' },
    },
    type: 'interaction.respond',
  });
  expect(transition.effects.map(({ type }) => type)).toEqual([
    'public.resolve',
    'provider.interaction.respond',
  ]);
  const delivery = effectOf(transition, 'provider.interaction.respond');

  let duplicate = reduceSession(transition.state, {
    ...observed,
    call: { callId: 'respond_02', epoch: 1, sessionId: 'session_01' },
    input: {
      requestId: 'permission_01',
      response: { kind: 'permission', optionId: 'allow', outcome: 'selected' },
    },
    type: 'interaction.respond',
  });
  expect(effectOf(duplicate, 'public.resolve')).toMatchObject({
    resolution: { kind: 'interaction', result: { state: 'already_resolved' } },
  });

  duplicate = reduceSession(transition.state, {
    ...observed,
    call: { callId: 'respond_03', epoch: 1, sessionId: 'session_01' },
    input: {
      requestId: 'permission_01',
      response: { kind: 'permission', outcome: 'denied' },
    },
    type: 'interaction.respond',
  });
  expect(effectOf(duplicate, 'public.reject').fault.code).toBe('revo.agent.interaction_conflict');

  transition = reduceSession(transition.state, {
    ...observed,
    correlation: delivery.correlation,
    type: 'provider.interaction.accepted',
  });
  const resolved = effectOf(transition, 'event.append');
  expect(resolved.event).toMatchObject({
    requestId: 'permission_01',
    type: 'interaction.resolved',
  });

  transition = reduceSession(transition.state, {
    ...observed,
    correlation: resolved.correlation,
    result: { state: 'appended' },
    type: 'event.applied',
  });
  expect(transition.state).toMatchObject({ interactions: [], turn: { status: 'streaming' } });
  expect(effectOf(transition, 'timer.schedule').timer).toMatchObject({
    generation: 2,
    kind: 'idle',
  });
});
