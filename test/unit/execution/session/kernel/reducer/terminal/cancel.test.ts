import { expect, test } from 'vitest';

import type { SessionEffect } from '../../../../../../../src/execution/session/kernel/effect/session-effect.js';
import { reduceSession } from '../../../../../../../src/execution/session/kernel/reducer/reduce.js';
import type { SessionTransition } from '../../../../../../../src/execution/session/kernel/reducer/transition.js';
import { idleSessionState } from '../../../../../../support/session/builders/kernel/session-state.js';

const observed = { observedAt: '2026-03-21T00:01:00.000Z', observedAtMs: 60_000 } as const;
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

test('session cancellation resolves on admission and finishes cleanup as cancelled', () => {
  let transition = reduceSession(idleSessionState(), {
    ...observed,
    call: { callId: 'cancel_01', epoch: 1, sessionId: 'session_01' },
    reason: 'consumer request',
    type: 'session.cancel',
  });
  expect(effectOf(transition, 'public.resolve')).toMatchObject({
    callId: 'cancel_01',
    resolution: { kind: 'cancel_session', result: { state: 'requested' } },
  });
  transition = reduceSession(transition.state, {
    ...observed,
    call: { callId: 'cancel_02', epoch: 1, sessionId: 'session_01' },
    type: 'session.cancel',
  });
  expect(effectOf(transition, 'public.resolve')).toMatchObject({ callId: 'cancel_02' });
  const cleanupCorrelation =
    transition.state.status === 'cancelling' &&
    transition.state.progress.stage === 'cleaning_process'
      ? transition.state.progress.correlation
      : undefined;
  if (cleanupCorrelation === undefined) throw new Error('Missing cleanup correlation.');
  transition = reduceSession(transition.state, {
    ...observed,
    correlation: cleanupCorrelation,
    type: 'process.cleanup.confirmed',
  });
  const remove = effectOf(transition, 'persistence.remove');
  transition = reduceSession(transition.state, {
    ...observed,
    correlation: remove.correlation,
    result: { state: 'not_owner' },
    type: 'persistence.applied',
  });
  const event = effectOf(transition, 'event.append');
  expect(event.event).toMatchObject({ outcome: 'cancelled', type: 'session.closed' });
  transition = reduceSession(transition.state, {
    ...observed,
    correlation: event.correlation,
    result: { state: 'appended' },
    type: 'event.applied',
  });
  const publication = effectOf(transition, 'output.publish');
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
  expect(transition).toMatchObject({ effects: [], state: { status: 'cancelled', timers: [] } });
});
