import { expect, test } from 'vitest';

import type { SessionEffect } from '../../../../../../../src/execution/session/kernel/effect/session-effect.js';
import { reduceInteractionEvent } from '../../../../../../../src/execution/session/kernel/reducer/interaction/events.js';
import { failInteractionSession } from '../../../../../../../src/execution/session/kernel/reducer/interaction/failure.js';
import { createOpeningSessionState } from '../../../../../../../src/execution/session/kernel/reducer/opening.js';
import { reduceSession } from '../../../../../../../src/execution/session/kernel/reducer/reduce.js';
import type { SessionTransition } from '../../../../../../../src/execution/session/kernel/reducer/transition.js';
import { sessionOpeningCommand } from '../../../../../../support/session/builders/kernel/opening.js';
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

test('ignores stale request publication and fails closed on a durable event conflict', () => {
  const requested = requestedInteraction();
  const stale = reduceSession(requested.state, {
    ...observed,
    correlation: { ...requested.requested.correlation, effectId: 'stale' },
    result: { state: 'appended' },
    type: 'event.applied',
  });
  expect(stale).toEqual({ effects: [], state: requested.state });

  const conflict = reduceSession(requested.state, {
    ...observed,
    correlation: requested.requested.correlation,
    result: { state: 'conflict' },
    type: 'event.applied',
  });
  expect(conflict.state).toMatchObject({
    intent: { error: { code: 'revo.agent.event_conflict' }, outcome: 'failed' },
    status: 'cancelling',
  });
});

test('ignores an interaction delivery outcome without a matching reservation', () => {
  const state = streamingSessionState();
  const transition = reduceSession(state, {
    ...observed,
    correlation: state.turn.correlation,
    type: 'provider.interaction.accepted',
  });
  expect(transition).toEqual({ effects: [], state });
});

test('acknowledges unrelated events and tolerates a missing requested interaction', () => {
  const requested = requestedInteraction();
  const state = requested.state;
  const inFlight = state.events.inFlight!;
  const unrelated = {
    eventId: 'turn-started',
    observedAt: observed.observedAt,
    prompt: 'Continue',
    schemaVersion: 'agent-session-event/v1' as const,
    sequence: state.nextEventSequence,
    sessionId: state.sessionId,
    streamId: state.streamId,
    turnId: 'turn_01',
    type: 'turn.started' as const,
  };
  const withUnrelated = {
    ...state,
    events: { ...state.events, inFlight: { correlation: inFlight.correlation, event: unrelated } },
  };
  const applied = {
    ...observed,
    correlation: inFlight.correlation,
    result: { state: 'appended' },
    type: 'event.applied',
  } as const;
  expect(
    reduceInteractionEvent(withUnrelated as Parameters<typeof reduceInteractionEvent>[0], applied)
      .state.events.cursor,
  ).toMatchObject({
    eventId: 'turn-started',
  });
  const withoutInteraction = { ...state, interactions: [] };
  expect(
    reduceInteractionEvent(
      withoutInteraction as Parameters<typeof reduceInteractionEvent>[0],
      applied,
    ).state.interactions,
  ).toEqual([]);
});

test('opening interaction failure begins owned-resource cleanup', () => {
  const command = sessionOpeningCommand();
  const state = createOpeningSessionState(command);
  expect(failInteractionSession(state, fault).state.status).toBe('failed');
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
