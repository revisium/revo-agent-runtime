import { expect, test } from 'vitest';

import type { SessionEffect } from '../../../../../../src/execution/session/kernel/effect/session-effect.js';
import { reduceSession } from '../../../../../../src/execution/session/kernel/reducer/reduce.js';
import type { SessionTransition } from '../../../../../../src/execution/session/kernel/reducer/transition.js';
import { idleSessionState } from '../../../../../support/session/builders/kernel/session-state.js';

const observedAt = '2026-03-21T00:01:00.000Z';
const outcome = (effect: { readonly correlation: SessionEffect['correlation'] }) => ({
  correlation: effect.correlation,
  observedAt,
  observedAtMs: 60_000,
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

test('closes an idle session only after cleanup, state removal, event, and output', () => {
  let transition = reduceSession(idleSessionState(), {
    call: { callId: 'close_01', epoch: 1, sessionId: 'session_01' },
    observedAt,
    observedAtMs: 60_000,
    type: 'session.close',
  });
  expect(transition.state).toMatchObject({
    progress: { stage: 'cleaning_process' },
    status: 'closing',
    timers: [],
  });
  expect(transition.effects.map(({ type }) => type)).toEqual([
    'timer.cancel',
    'timer.cancel',
    'provider.close',
    'process.cleanup',
  ]);

  transition = reduceSession(transition.state, {
    call: { callId: 'close_02', epoch: 1, sessionId: 'session_01' },
    observedAt,
    observedAtMs: 60_000,
    type: 'session.close',
  });
  expect(transition.effects).toEqual([]);
  expect(transition.state).toMatchObject({ callIds: ['close_01', 'close_02'] });

  const cleanupCorrelation =
    transition.state.status === 'closing' && transition.state.progress.stage === 'cleaning_process'
      ? transition.state.progress.correlation
      : undefined;
  if (cleanupCorrelation === undefined) throw new Error('Missing cleanup correlation.');
  transition = reduceSession(transition.state, {
    correlation: cleanupCorrelation,
    observedAt,
    observedAtMs: 60_000,
    type: 'process.cleanup.confirmed',
  });
  expect(transition.state).toMatchObject({ progress: { stage: 'removing_state' } });

  const remove = effectOf(transition, 'persistence.remove');
  transition = reduceSession(transition.state, {
    ...outcome(remove),
    result: { state: 'applied' },
    type: 'persistence.applied',
  });
  const closedEvent = effectOf(transition, 'event.append');
  expect(closedEvent.event).toMatchObject({ outcome: 'closed', type: 'session.closed' });

  transition = reduceSession(transition.state, {
    ...outcome(closedEvent),
    result: { state: 'appended' },
    type: 'event.applied',
  });
  const publication = effectOf(transition, 'output.publish');
  expect(publication.publication).toMatchObject({ status: 'closed' });

  transition = reduceSession(transition.state, {
    ...outcome(publication),
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
  expect(transition.state).toMatchObject({ finishedAt: observedAt, status: 'closed', timers: [] });
  expect(effectOf(transition, 'public.resolve')).toMatchObject({
    callId: 'close_01',
    resolution: { kind: 'close', result: { state: 'closed' } },
  });
  expect(transition.effects.filter(({ type }) => type === 'public.resolve')).toHaveLength(2);
  const terminal = transition.state;
  expect(
    reduceSession(terminal, {
      call: { callId: 'late_close', epoch: 1, sessionId: 'session_01' },
      observedAt,
      observedAtMs: 60_001,
      type: 'session.close',
    }).effects,
  ).toEqual([
    expect.objectContaining({
      type: 'public.resolve',
      callId: 'late_close',
      resolution: { kind: 'close', result: { state: 'already_terminal' } },
    }),
  ]);
});
