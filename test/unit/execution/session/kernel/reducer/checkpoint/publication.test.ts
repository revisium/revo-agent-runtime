import { expect, test } from 'vitest';

import type { SessionEffect } from '../../../../../../../src/execution/session/kernel/effect/session-effect.js';
import { reduceSession } from '../../../../../../../src/execution/session/kernel/reducer/reduce.js';
import type { SessionTransition } from '../../../../../../../src/execution/session/kernel/reducer/transition.js';
import { idleSessionState } from '../../../../../../support/session/builders/kernel/session-state.js';

const observed = { observedAt: '2026-03-21T00:00:03.000Z', observedAtMs: 3_000 } as const;
const fault = {
  code: 'revo.agent.output_write_failed',
  message: 'Output publication failed.',
  phase: 'finalizing',
  retryable: false,
} as const;
const publishedOutput = {
  files: {
    directory: '/output',
    manifest: 'session.json',
    stderr: 'stderr.log',
    stdout: 'stdout.log',
  },
  state: 'published',
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

const outputPublication = () => {
  let transition = reduceSession(idleSessionState(), {
    ...observed,
    call: { callId: 'hibernate_call_01', epoch: 1, sessionId: 'session_01' },
    resumeTokenId: 'token_01',
    type: 'session.hibernate',
  });
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
    type: 'persistence.applied',
  });
  return { output: effectOf(transition, 'output.publish'), state: transition.state };
};

test('withholds the token when output publication fails', () => {
  const publication = outputPublication();
  const transition = reduceSession(publication.state, {
    ...observed,
    correlation: publication.output.correlation,
    output: { error: fault, files: { directory: '/output' }, state: 'failed' },
    type: 'output.failed',
  });
  expect(transition.state).toMatchObject({ error: fault, status: 'failed' });
  expect(transition.effects.map(({ type }) => type)).toEqual(['public.reject']);
});

test('clears a failed hibernation append without exposing the token', () => {
  const publication = outputPublication();
  let transition = reduceSession(publication.state, {
    ...observed,
    correlation: publication.output.correlation,
    output: publishedOutput,
    type: 'output.published',
  });
  const event = effectOf(transition, 'event.append');
  transition = reduceSession(transition.state, {
    ...observed,
    correlation: event.correlation,
    fault,
    type: 'event.failed',
  });
  expect(transition.state).toMatchObject({ error: fault, status: 'failed' });
  expect(transition.state.events).toEqual({
    cursor: idleSessionState().events.cursor,
    pending: [],
  });
  expect(transition.effects.map(({ type }) => type)).toEqual(['public.reject']);
});
