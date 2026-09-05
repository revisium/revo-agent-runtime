import { expect, test } from 'vitest';

import type { SessionEffect } from '../../../../../../../src/execution/session/kernel/effect/session-effect.js';
import { reduceSession } from '../../../../../../../src/execution/session/kernel/reducer/reduce.js';
import type { SessionTransition } from '../../../../../../../src/execution/session/kernel/reducer/transition.js';
import { idleSessionState } from '../../../../../../support/session/builders/kernel/session-state.js';

const observed = { observedAt: '2026-03-21T00:00:03.000Z', observedAtMs: 3_000 } as const;
const command = {
  ...observed,
  call: { callId: 'hibernate_call_01', epoch: 1, sessionId: 'session_01' },
  reason: 'Waiting for the user',
  resumeTokenId: 'token_01',
  type: 'session.hibernate',
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

test('releases a resume token only after confirmed hibernation', () => {
  let transition = reduceSession(idleSessionState(), command);
  expect(transition.state).toMatchObject({
    progress: { stage: 'capturing' },
    resumeTokenId: 'token_01',
    status: 'hibernating',
  });
  expect(transition.effects.map(({ type }) => type)).toEqual([
    'timer.cancel',
    'checkpoint.capture',
  ]);
  const capture = effectOf(transition, 'checkpoint.capture');
  expect(capture).toMatchObject({ kind: 'hibernate', resumeTokenId: 'token_01' });

  const resumeToken = {
    cursor: { eventId: 'session_01:1:event:3', sequence: 3, streamId: 'stream_01' },
    eligibility: 'hibernated',
    payload: 'opaque-provider-state',
    pin: idleSessionState().pin,
    resumeTokenId: 'token_01',
    schemaVersion: 'agent-session-resume-token/v1',
    sessionId: 'session_01',
    sha256: 'resume-token-sha256',
  } as const;
  transition = reduceSession(transition.state, {
    ...observed,
    correlation: capture.correlation,
    kind: 'hibernate',
    resumeToken,
    type: 'checkpoint.captured',
  });
  expect(transition.effects.map(({ type }) => type)).toEqual([
    'timer.cancel',
    'provider.close',
    'process.cleanup',
  ]);
  expect(transition.effects.map(({ type }) => type)).not.toContain('event.append');

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
    result: { state: 'applied' },
    type: 'persistence.late_applied',
  });
  const output = effectOf(transition, 'output.publish');
  expect(output.publication).toMatchObject({ status: 'hibernated' });

  transition = reduceSession(transition.state, {
    ...observed,
    correlation: output.correlation,
    output: {
      files: {
        directory: '/output',
        manifest: 'session.json',
        stderr: 'stderr.log',
        stdout: 'stdout.log',
      },
      state: 'published',
    },
    type: 'output.published',
  });
  const hibernated = effectOf(transition, 'event.append');
  expect(hibernated.event).toMatchObject({
    resumeTokenId: 'token_01',
    resumeTokenSha256: 'resume-token-sha256',
    type: 'session.hibernated',
  });

  transition = reduceSession(transition.state, {
    ...observed,
    correlation: hibernated.correlation,
    result: { state: 'appended' },
    type: 'event.applied',
  });
  expect(transition.state).toMatchObject({ resumeToken, status: 'hibernated' });
  expect(effectOf(transition, 'public.resolve')).toMatchObject({
    callId: 'hibernate_call_01',
    resolution: {
      kind: 'hibernate',
      result: { resumeToken, state: 'hibernated' },
    },
  });
});

test('rejects hibernation when native continuation is unavailable', () => {
  const state = idleSessionState();
  const transition = reduceSession(
    { ...state, capabilities: { ...state.capabilities, resume: 'none' } },
    command,
  );
  expect(effectOf(transition, 'public.reject').fault.code).toBe(
    'revo.agent.checkpoint_unsupported',
  );
  expect(transition.state.status).toBe('idle');
});
