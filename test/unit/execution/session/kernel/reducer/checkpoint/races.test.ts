import { expect, test } from 'vitest';

import type { SessionEffect } from '../../../../../../../src/execution/session/kernel/effect/session-effect.js';
import { reduceSession } from '../../../../../../../src/execution/session/kernel/reducer/reduce.js';
import type { SessionTransition } from '../../../../../../../src/execution/session/kernel/reducer/transition.js';
import { idleSessionState } from '../../../../../../support/session/builders/kernel/session-state.js';

const observed = { observedAt: '2026-03-21T00:00:03.000Z', observedAtMs: 3_000 } as const;
const checkpointCommand = {
  ...observed,
  call: { callId: 'checkpoint_call_01', epoch: 1, sessionId: 'session_01' },
  checkpointId: 'checkpoint_01',
  type: 'session.checkpoint',
} as const;
const cancelCommand = {
  ...observed,
  call: { callId: 'cancel_call_01', epoch: 1, sessionId: 'session_01' },
  reason: 'Stop now',
  type: 'session.cancel',
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

const checkpoint = {
  checkpointId: 'checkpoint_01',
  cursor: { eventId: 'session_01:1:event:3', sequence: 3, streamId: 'stream_01' },
  eligibility: 'observation_only',
  payload: 'payload',
  pin: idleSessionState().pin,
  schemaVersion: 'agent-session-checkpoint/v1',
  sessionId: 'session_01',
  sha256: 'sha256',
} as const;

test('cancellation wins while checkpoint capture is still in flight', () => {
  const started = reduceSession(idleSessionState(), checkpointCommand);
  const capture = effectOf(started, 'checkpoint.capture');
  const cancelled = reduceSession(started.state, cancelCommand);

  expect(cancelled.state).toMatchObject({ intent: { outcome: 'cancelled' }, status: 'cancelling' });
  expect(cancelled.effects.map(({ type }) => type)).toEqual([
    'timer.cancel',
    'provider.close',
    'process.cleanup',
    'public.resolve',
    'public.reject',
  ]);
  const late = reduceSession(cancelled.state, {
    ...observed,
    checkpoint,
    correlation: capture.correlation,
    kind: 'checkpoint',
    type: 'checkpoint.captured',
  });
  expect(late).toEqual({ effects: [], state: cancelled.state });
});

test('an accepted cancel waits behind an already captured checkpoint event', () => {
  let transition = reduceSession(idleSessionState(), checkpointCommand);
  const capture = effectOf(transition, 'checkpoint.capture');
  transition = reduceSession(transition.state, {
    ...observed,
    checkpoint,
    correlation: capture.correlation,
    kind: 'checkpoint',
    type: 'checkpoint.captured',
  });
  const event = effectOf(transition, 'event.append');

  transition = reduceSession(transition.state, cancelCommand);
  expect(transition.state).toMatchObject({
    status: 'checkpointing',
    terminalAfterCheckpoint: { outcome: 'cancelled' },
  });
  expect(effectOf(transition, 'public.resolve')).toMatchObject({
    resolution: { kind: 'cancel_session', result: { state: 'requested' } },
  });

  const wall = transition.state.timers.find(({ kind }) => kind === 'wall_clock')!;
  transition = reduceSession(transition.state, {
    correlation: { effectId: 'wall_callback', epoch: 1, sessionId: 'session_01' },
    firedAt: observed.observedAt,
    firedAtMs: observed.observedAtMs,
    generation: wall.generation,
    kind: wall.kind,
    timerId: wall.timerId,
    type: 'timer.fired',
  });
  expect(transition.state).toMatchObject({ terminalAfterCheckpoint: { outcome: 'cancelled' } });

  transition = reduceSession(transition.state, {
    ...observed,
    correlation: event.correlation,
    result: { state: 'appended' },
    type: 'event.applied',
  });
  expect(transition.state).toMatchObject({
    intent: { outcome: 'cancelled' },
    status: 'cancelling',
  });
  expect(transition.effects.map(({ type }) => type)).toEqual([
    'timer.cancel',
    'provider.close',
    'process.cleanup',
    'public.resolve',
  ]);
});

test('cancellation takes over hibernation before state removal commits', () => {
  const hibernate = {
    ...observed,
    call: { callId: 'hibernate_call_01', epoch: 1, sessionId: 'session_01' },
    resumeTokenId: 'token_01',
    type: 'session.hibernate',
  } as const;
  let transition = reduceSession(idleSessionState(), hibernate);
  const capture = effectOf(transition, 'checkpoint.capture');
  transition = reduceSession(transition.state, {
    ...observed,
    correlation: capture.correlation,
    kind: 'hibernate',
    resumeToken: {
      cursor: { eventId: 'session_01:1:event:3', sequence: 3, streamId: 'stream_01' },
      eligibility: 'hibernated',
      payload: 'payload',
      pin: idleSessionState().pin,
      resumeTokenId: 'token_01',
      schemaVersion: 'agent-session-resume-token/v1',
      sessionId: 'session_01',
      sha256: 'sha256',
    },
    type: 'checkpoint.captured',
  });
  const cleanup = effectOf(transition, 'process.cleanup');

  transition = reduceSession(transition.state, cancelCommand);
  expect(transition.state).toMatchObject({
    intent: { outcome: 'cancelled' },
    status: 'cancelling',
  });
  expect(transition.effects.map(({ type }) => type)).toEqual(['public.reject', 'public.resolve']);

  transition = reduceSession(transition.state, {
    ...observed,
    correlation: cleanup.correlation,
    type: 'process.cleanup.confirmed',
  });
  expect(effectOf(transition, 'persistence.remove')).toBeDefined();
});
