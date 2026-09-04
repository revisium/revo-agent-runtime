import { expect, test } from 'vitest';

import type { SessionEffect } from '../../../../../../../src/execution/session/kernel/effect/session-effect.js';
import { reduceSession } from '../../../../../../../src/execution/session/kernel/reducer/reduce.js';
import type { SessionTransition } from '../../../../../../../src/execution/session/kernel/reducer/transition.js';
import { idleSessionState } from '../../../../../../support/session/builders/kernel/session-state.js';

const observed = { observedAt: '2026-03-21T00:00:03.000Z', observedAtMs: 3_000 } as const;
const hibernateCommand = {
  ...observed,
  call: { callId: 'hibernate_call_01', epoch: 1, sessionId: 'session_01' },
  resumeTokenId: 'token_01',
  type: 'session.hibernate',
} as const;
const fault = {
  code: 'revo.agent.protocol_failed',
  message: 'Provider failed.',
  phase: 'session_checkpointing',
  retryable: false,
} as const;

const effectOf = <Type extends SessionEffect['type']>(
  transition: SessionTransition,
  type: Type,
): Extract<SessionEffect, { readonly type: Type }> => {
  const value = transition.effects.find(
    (candidate): candidate is Extract<SessionEffect, { readonly type: Type }> =>
      candidate.type === type,
  );
  if (value === undefined) throw new Error(`Missing ${type} effect.`);
  return value;
};

const capturedHibernation = () => {
  const started = reduceSession(idleSessionState(), hibernateCommand);
  const capture = effectOf(started, 'checkpoint.capture');
  return reduceSession(started.state, {
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
};

test('rejects a captured checkpoint with the wrong reserved cursor', () => {
  const command = {
    ...observed,
    call: { callId: 'checkpoint_call_01', epoch: 1, sessionId: 'session_01' },
    checkpointId: 'checkpoint_01',
    type: 'session.checkpoint',
  } as const;
  const started = reduceSession(idleSessionState(), command);
  const capture = effectOf(started, 'checkpoint.capture');
  const transition = reduceSession(started.state, {
    ...observed,
    checkpoint: {
      checkpointId: 'checkpoint_01',
      cursor: { eventId: 'wrong', sequence: 2, streamId: 'stream_01' },
      eligibility: 'observation_only',
      payload: 'payload',
      pin: idleSessionState().pin,
      schemaVersion: 'agent-session-checkpoint/v1',
      sessionId: 'session_01',
      sha256: 'sha256',
    },
    correlation: capture.correlation,
    kind: 'checkpoint',
    type: 'checkpoint.captured',
  });
  expect(transition.state.status).toBe('idle');
  expect(effectOf(transition, 'public.reject').fault.code).toBe('revo.agent.checkpoint_invalid');
});

test('restores the idle session after a token capture failure', () => {
  const started = reduceSession(idleSessionState(), hibernateCommand);
  const capture = effectOf(started, 'checkpoint.capture');
  const transition = reduceSession(started.state, {
    ...observed,
    correlation: capture.correlation,
    fault,
    type: 'checkpoint.failed',
  });
  expect(transition.state.status).toBe('idle');
  expect(transition.effects.map(({ type }) => type)).toEqual(['timer.schedule', 'public.reject']);
});

test('retains process identity when hibernation cleanup is uncertain', () => {
  const captured = capturedHibernation();
  const cleanup = effectOf(captured, 'process.cleanup');
  const transition = reduceSession(captured.state, {
    ...observed,
    correlation: cleanup.correlation,
    fault,
    type: 'process.cleanup.uncertain',
  });
  expect(transition.state).toMatchObject({
    processResourceId: 'process_01',
    status: 'cleanup_uncertain',
  });
  expect(effectOf(transition, 'public.reject').fault).toBe(fault);
});

test('treats authoritative not-owner removal as durable absence', () => {
  let transition = capturedHibernation();
  const cleanup = effectOf(transition, 'process.cleanup');
  transition = reduceSession(transition.state, {
    ...observed,
    correlation: cleanup.correlation,
    type: 'process.cleanup.confirmed',
  });
  const removal = effectOf(transition, 'persistence.remove');
  transition = reduceSession(transition.state, {
    ...observed,
    correlation: removal.correlation,
    result: { state: 'not_owner' },
    type: 'persistence.applied',
  });
  expect(transition.state.status).toBe('hibernating');
  expect(effectOf(transition, 'output.publish')).toBeDefined();
});

test('withholds the token when conditional state removal is unknown', () => {
  let transition = capturedHibernation();
  const cleanup = effectOf(transition, 'process.cleanup');
  transition = reduceSession(transition.state, {
    ...observed,
    correlation: cleanup.correlation,
    type: 'process.cleanup.confirmed',
  });
  const removal = effectOf(transition, 'persistence.remove');
  transition = reduceSession(transition.state, {
    ...observed,
    correlation: removal.correlation,
    fault,
    type: 'persistence.unknown',
  });
  expect(transition.state.status).toBe('cleanup_uncertain');
  expect(effectOf(transition, 'public.reject').fault).toBe(fault);
});
