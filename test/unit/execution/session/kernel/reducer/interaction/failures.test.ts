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
const fault = {
  code: 'revo.agent.protocol_failed',
  message: 'Interaction delivery failed.',
  phase: 'session_running',
  retryable: false,
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

const requestedInteraction = () => {
  const state = streamingSessionState();
  const transition = reduceSession(state, {
    ...observed,
    correlation: state.turn.correlation,
    providerResourceId: 'provider_01',
    request: permission,
    scope: { kind: 'turn', turnId: 'turn_01' },
    type: 'provider.interaction_requested',
  });
  return { requested: effectOf(transition, 'event.append'), state: transition.state };
};

test('fails closed when request publication fails', () => {
  const requested = requestedInteraction();
  const transition = reduceSession(requested.state, {
    ...observed,
    correlation: requested.requested.correlation,
    fault,
    type: 'event.failed',
  });
  expect(transition.state).toMatchObject({
    intent: { error: fault, outcome: 'failed' },
    status: 'cancelling',
  });
});

test('fails closed when the provider rejects a reserved response', () => {
  const requested = requestedInteraction();
  let transition = reduceSession(requested.state, {
    ...observed,
    correlation: requested.requested.correlation,
    result: { state: 'appended' },
    type: 'event.applied',
  });
  transition = reduceSession(transition.state, {
    ...observed,
    call: { callId: 'respond_01', epoch: 1, sessionId: 'session_01' },
    input: {
      requestId: 'permission_01',
      response: { kind: 'permission', optionId: 'allow', outcome: 'selected' },
    },
    type: 'interaction.respond',
  });
  const response = effectOf(transition, 'provider.interaction.respond');
  transition = reduceSession(transition.state, {
    ...observed,
    correlation: response.correlation,
    fault,
    type: 'provider.interaction.rejected',
  });
  expect(transition.state).toMatchObject({
    intent: { error: fault, outcome: 'failed' },
    status: 'cancelling',
  });
});

test('rejects a late or unknown response without touching the session', () => {
  const state = streamingSessionState();
  const transition = reduceSession(state, {
    ...observed,
    call: { callId: 'respond_late', epoch: 1, sessionId: 'session_01' },
    input: { requestId: 'resolved_earlier', response: { kind: 'input', outcome: 'cancelled' } },
    type: 'interaction.respond',
  });
  expect(effectOf(transition, 'public.reject').fault.code).toBe('revo.agent.interaction_unknown');
  expect(transition.state.interactions).toEqual([]);
});

test('pauses only inactivity while a published interaction awaits a human', () => {
  const requested = requestedInteraction();
  const transition = reduceSession(requested.state, {
    ...observed,
    correlation: requested.requested.correlation,
    result: { state: 'appended' },
    type: 'event.applied',
  });
  expect(transition.state.timers.map(({ kind }) => kind)).toEqual(['wall_clock']);

  const staleIdle = reduceSession(transition.state, {
    correlation: { effectId: 'timer_idle', epoch: 1, sessionId: 'session_01' },
    firedAt: observed.observedAt,
    firedAtMs: observed.observedAtMs,
    generation: 1,
    kind: 'idle',
    timerId: 'session_01:1:idle',
    type: 'timer.fired',
  });
  expect(staleIdle).toEqual({ effects: [], state: transition.state });

  const wall = transition.state.timers[0]!;
  const expired = reduceSession(transition.state, {
    correlation: { effectId: 'timer_wall', epoch: 1, sessionId: 'session_01' },
    firedAt: observed.observedAt,
    firedAtMs: observed.observedAtMs,
    generation: wall.generation,
    kind: wall.kind,
    timerId: wall.timerId,
    type: 'timer.fired',
  });
  expect(expired.state).toMatchObject({
    intent: { outcome: 'timed_out', timeout: 'wall_clock_timeout' },
    status: 'cancelling',
  });
});
