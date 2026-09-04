import { expect, test } from 'vitest';

import type { SessionEffect } from '../../../../../../../src/execution/session/kernel/effect/session-effect.js';
import { reduceSession } from '../../../../../../../src/execution/session/kernel/reducer/reduce.js';
import type { SessionTransition } from '../../../../../../../src/execution/session/kernel/reducer/transition.js';
import { streamingSessionState } from '../../../../../../support/session/builders/kernel/running.js';

const observed = { observedAt: '2026-03-21T00:00:02.000Z', observedAtMs: 2_000 } as const;
const permission = (requestId: string) => ({
  action: { kind: 'execute' as const },
  kind: 'permission' as const,
  options: [{ kind: 'allow_once' as const, label: 'Allow', optionId: 'allow' }],
  requestId,
});

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

test('serializes durable events while two interaction responses progress independently', () => {
  const initial = streamingSessionState();
  let transition = reduceSession(initial, {
    ...observed,
    correlation: initial.turn.correlation,
    providerResourceId: 'provider_01',
    request: permission('request_01'),
    scope: { kind: 'turn', turnId: 'turn_01' },
    type: 'provider.interaction_requested',
  });
  const firstRequested = effectOf(transition, 'event.append');
  transition = reduceSession(transition.state, {
    ...observed,
    correlation: initial.turn.correlation,
    providerResourceId: 'provider_01',
    request: permission('request_02'),
    scope: { kind: 'turn', turnId: 'turn_01' },
    type: 'provider.interaction_requested',
  });
  expect(transition.effects).toEqual([]);

  transition = reduceSession(transition.state, {
    ...observed,
    correlation: firstRequested.correlation,
    result: { state: 'appended' },
    type: 'event.applied',
  });
  const secondRequested = effectOf(transition, 'event.append');

  transition = reduceSession(transition.state, {
    ...observed,
    call: { callId: 'respond_01', epoch: 1, sessionId: 'session_01' },
    input: {
      requestId: 'request_01',
      response: { kind: 'permission', optionId: 'allow', outcome: 'selected' },
    },
    type: 'interaction.respond',
  });
  const firstDelivery = effectOf(transition, 'provider.interaction.respond');
  transition = reduceSession(transition.state, {
    ...observed,
    call: { callId: 'respond_02', epoch: 1, sessionId: 'session_01' },
    input: { requestId: 'request_02', response: { kind: 'permission', outcome: 'denied' } },
    type: 'interaction.respond',
  });
  expect(transition.effects.map(({ type }) => type)).toEqual(['public.resolve']);

  transition = reduceSession(transition.state, {
    ...observed,
    correlation: firstDelivery.correlation,
    type: 'provider.interaction.accepted',
  });
  expect(transition.effects).toEqual([]);

  transition = reduceSession(transition.state, {
    ...observed,
    correlation: secondRequested.correlation,
    result: { state: 'appended' },
    type: 'event.applied',
  });
  expect(transition.effects.map(({ type }) => type)).toEqual([
    'event.append',
    'provider.interaction.respond',
  ]);
  const firstResolved = effectOf(transition, 'event.append');
  const secondDelivery = effectOf(transition, 'provider.interaction.respond');

  transition = reduceSession(transition.state, {
    ...observed,
    correlation: secondDelivery.correlation,
    type: 'provider.interaction.accepted',
  });
  expect(transition.effects).toEqual([]);
  transition = reduceSession(transition.state, {
    ...observed,
    correlation: firstResolved.correlation,
    result: { state: 'appended' },
    type: 'event.applied',
  });
  expect(transition.state.interactions).toHaveLength(1);
  expect(transition.effects.map(({ type }) => type)).toEqual(['event.append']);
  const secondResolved = effectOf(transition, 'event.append');

  transition = reduceSession(transition.state, {
    ...observed,
    correlation: secondResolved.correlation,
    result: { state: 'appended' },
    type: 'event.applied',
  });
  expect(transition.state).toMatchObject({ interactions: [], turn: { status: 'streaming' } });
  expect(transition.effects.map(({ type }) => type)).toEqual(['timer.schedule']);
});
