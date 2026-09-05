import { expect, test } from 'vitest';

import type { SessionEffect } from '../../../../../../../src/execution/session/kernel/effect/session-effect.js';
import { reduceSession } from '../../../../../../../src/execution/session/kernel/reducer/reduce.js';
import type { SessionTransition } from '../../../../../../../src/execution/session/kernel/reducer/transition.js';
import { idleSessionState } from '../../../../../../support/session/builders/kernel/session-state.js';

const observed = { observedAt: '2026-03-21T00:01:00.000Z', observedAtMs: 60_000 } as const;
const fault = {
  code: 'revo.agent.active_state_failed',
  message: 'failed',
  phase: 'session_terminal',
  retryable: true,
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
const closing = () =>
  reduceSession(idleSessionState(), {
    ...observed,
    call: { callId: 'close_01', epoch: 1, sessionId: 'session_01' },
    type: 'session.close',
  });
const removing = () => {
  const started = closing();
  return reduceSession(started.state, {
    ...observed,
    correlation: effectOf(started, 'process.cleanup').correlation,
    type: 'process.cleanup.confirmed',
  });
};
const publishingEvent = () => {
  const started = removing();
  return reduceSession(started.state, {
    ...observed,
    correlation: effectOf(started, 'persistence.remove').correlation,
    result: { state: 'applied' },
    type: 'persistence.applied',
  });
};
const publishingOutput = () => {
  const started = publishingEvent();
  return reduceSession(started.state, {
    ...observed,
    correlation: effectOf(started, 'event.append').correlation,
    result: { state: 'appended' },
    type: 'event.timed_out_then_applied',
  });
};

test('cleanup uncertainty remains visible and retains process ownership', () => {
  const started = closing();
  const transition = reduceSession(started.state, {
    ...observed,
    correlation: effectOf(started, 'process.cleanup').correlation,
    fault: { ...fault, code: 'revo.agent.process_cleanup_failed' },
    type: 'process.cleanup.uncertain',
  });
  expect(transition.state).toMatchObject({
    processResourceId: 'process_01',
    status: 'cleanup_uncertain',
  });
});

test.each(['persistence.failed', 'persistence.late_failed', 'persistence.unknown'] as const)(
  '%s during removal remains cleanup-uncertain',
  (type) => {
    const started = removing();
    const transition = reduceSession(started.state, {
      ...observed,
      correlation: effectOf(started, 'persistence.remove').correlation,
      fault,
      type,
    });
    expect(transition.state).toMatchObject({ error: fault, status: 'cleanup_uncertain' });
  },
);

test.each(['output.failed', 'output.uncertain'] as const)(
  'records %s without losing confirmed terminal cleanup',
  (type) => {
    const started = publishingOutput();
    const output =
      type === 'output.failed'
        ? ({ error: fault, files: { directory: '/output' }, state: 'failed' } as const)
        : ({ error: fault, files: { directory: '/output' }, state: 'uncertain' } as const);
    const transition =
      type === 'output.failed'
        ? reduceSession(started.state, {
            ...observed,
            correlation: effectOf(started, 'output.publish').correlation,
            output: { ...output, state: 'failed' },
            type,
          })
        : reduceSession(started.state, {
            ...observed,
            correlation: effectOf(started, 'output.publish').correlation,
            output: { ...output, state: 'uncertain' },
            type,
          });
    expect(transition.state).toMatchObject({ output, status: 'failed' });
    expect(effectOf(transition, 'public.reject')).toMatchObject({ callId: 'close_01' });
  },
);

test('terminal event delivery failure publishes output and rejects graceful close', () => {
  const started = publishingEvent();
  let transition = reduceSession(started.state, {
    ...observed,
    correlation: effectOf(started, 'event.append').correlation,
    fault: { ...fault, code: 'revo.agent.event_sink_failed', phase: 'session_delivery' },
    type: 'event.failed',
  });
  const publication = effectOf(transition, 'output.publish');
  expect(publication.publication.status).toBe('failed');
  transition = reduceSession(transition.state, {
    ...observed,
    correlation: publication.correlation,
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
  expect(transition.state.status).toBe('failed');
  expect(effectOf(transition, 'public.reject')).toMatchObject({ callId: 'close_01' });
});
