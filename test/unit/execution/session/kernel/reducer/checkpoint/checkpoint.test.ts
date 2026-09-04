import { expect, test } from 'vitest';

import type { SessionEffect } from '../../../../../../../src/execution/session/kernel/effect/session-effect.js';
import { reduceSession } from '../../../../../../../src/execution/session/kernel/reducer/reduce.js';
import type { SessionTransition } from '../../../../../../../src/execution/session/kernel/reducer/transition.js';
import { streamingSessionState } from '../../../../../../support/session/builders/kernel/running.js';
import { idleSessionState } from '../../../../../../support/session/builders/kernel/session-state.js';

const observed = { observedAt: '2026-03-21T00:00:03.000Z', observedAtMs: 3_000 } as const;
const command = {
  ...observed,
  call: { callId: 'checkpoint_call_01', epoch: 1, sessionId: 'session_01' },
  checkpointId: 'checkpoint_01',
  type: 'session.checkpoint',
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

test('returns an observation checkpoint only after its cursor event is durable', () => {
  let transition = reduceSession(idleSessionState(), command);

  expect(transition.state).toMatchObject({
    checkpointId: 'checkpoint_01',
    progress: { stage: 'capturing' },
    status: 'checkpointing',
  });
  expect(transition.effects.map(({ type }) => type)).toEqual([
    'timer.cancel',
    'checkpoint.capture',
  ]);
  const capture = effectOf(transition, 'checkpoint.capture');
  expect(capture).toMatchObject({
    checkpointId: 'checkpoint_01',
    cursor: { sequence: 2 },
    kind: 'checkpoint',
    usageBaseline: { scope: 'session_cumulative' },
  });

  const checkpoint = {
    checkpointId: 'checkpoint_01',
    cursor: { eventId: 'session_01:1:event:3', sequence: 3, streamId: 'stream_01' },
    eligibility: 'observation_only',
    payload: 'opaque-provider-state',
    pin: idleSessionState().pin,
    schemaVersion: 'agent-session-checkpoint/v1',
    sessionId: 'session_01',
    sha256: 'checkpoint-sha256',
  } as const;
  transition = reduceSession(transition.state, {
    ...observed,
    checkpoint,
    correlation: capture.correlation,
    kind: 'checkpoint',
    type: 'checkpoint.captured',
  });
  const appended = effectOf(transition, 'event.append');
  expect(appended.event).toMatchObject({
    checkpointId: 'checkpoint_01',
    checkpointSha256: 'checkpoint-sha256',
    type: 'session.checkpointed',
  });

  transition = reduceSession(transition.state, {
    ...observed,
    correlation: appended.correlation,
    result: { state: 'appended' },
    type: 'event.applied',
  });
  expect(transition.state.status).toBe('idle');
  expect(transition.effects.map(({ type }) => type)).toEqual(['timer.schedule', 'public.resolve']);
  expect(effectOf(transition, 'public.resolve')).toMatchObject({
    callId: 'checkpoint_call_01',
    resolution: { checkpoint, kind: 'checkpoint' },
  });
});

test('rejects a checkpoint while the session is busy', () => {
  const transition = reduceSession(streamingSessionState(), command);
  expect(effectOf(transition, 'public.reject').fault.code).toBe('revo.agent.session_busy');
  expect(transition.state.status).toBe('running');
});

test('rejects a checkpoint when no durable cursor exists', () => {
  const state = idleSessionState();
  const transition = reduceSession({ ...state, events: { pending: [] } }, command);
  expect(effectOf(transition, 'public.reject').fault.code).toBe('revo.agent.checkpoint_invalid');
  expect(transition.state.status).toBe('idle');
});

test('returns an unsupported capture failure and restores idle timing', () => {
  let transition = reduceSession(idleSessionState(), command);
  const capture = effectOf(transition, 'checkpoint.capture');
  transition = reduceSession(transition.state, {
    ...observed,
    correlation: capture.correlation,
    fault: {
      code: 'revo.agent.checkpoint_unsupported',
      message: 'Provider cannot capture continuation state.',
      phase: 'session_checkpointing',
      retryable: false,
    },
    type: 'checkpoint.unsupported',
  });

  expect(transition.state.status).toBe('idle');
  expect(transition.effects.map(({ type }) => type)).toEqual(['timer.schedule', 'public.reject']);
  expect(effectOf(transition, 'public.reject').fault.code).toBe(
    'revo.agent.checkpoint_unsupported',
  );
});
