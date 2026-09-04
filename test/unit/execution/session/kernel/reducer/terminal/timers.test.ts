import { expect, test } from 'vitest';

import type { SessionEffect } from '../../../../../../../src/execution/session/kernel/effect/session-effect.js';
import { reduceSession } from '../../../../../../../src/execution/session/kernel/reducer/reduce.js';
import type { SessionTransition } from '../../../../../../../src/execution/session/kernel/reducer/transition.js';
import { idleSessionState } from '../../../../../../support/session/builders/kernel/session-state.js';

const timerCommand = (generation: number, kind: 'idle' | 'wall_clock' = 'idle') => ({
  correlation: { effectId: 'timer_callback', epoch: 1, sessionId: 'session_01' },
  firedAt: '2026-03-21T00:00:12.000Z',
  firedAtMs: 12_000,
  generation,
  kind,
  timerId: kind === 'idle' ? 'session_01:1:idle' : 'session_01:1:wall',
  type: 'timer.fired' as const,
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

test('ignores a queued stale timer callback after inactivity reset', () => {
  const state = idleSessionState();
  const reset = {
    ...state,
    timers: state.timers.map((timer) =>
      timer.kind === 'idle' ? { ...timer, generation: 2 } : timer,
    ),
  };
  expect(reduceSession(reset, timerCommand(1))).toEqual({ effects: [], state: reset });
});

test('accepted activity resets only inactivity and never extends the wall deadline', () => {
  const state = idleSessionState();
  const transition = reduceSession(state, {
    call: { callId: 'send_01', epoch: 1, sessionId: 'session_01', turnId: 'turn_01' },
    input: { prompt: 'Continue', turnId: 'turn_01' },
    observedAt: '2026-03-21T00:00:02.000Z',
    observedAtMs: 2_000,
    resultCallId: 'result_01',
    type: 'turn.send',
  });
  expect(transition.state.timers).toEqual([
    state.timers[0],
    { deadlineMs: 12_000, generation: 2, kind: 'idle', timerId: 'session_01:1:idle' },
  ]);
});

test('a current inactivity timer starts timed-out terminal cleanup and clears timers', () => {
  const state = idleSessionState();
  const transition = reduceSession(state, timerCommand(1));
  expect(transition.state).toMatchObject({
    intent: { outcome: 'timed_out', timeout: 'idle_timeout' },
    progress: { stage: 'cleaning_process' },
    status: 'cancelling',
    timers: [],
  });
  expect(transition.effects.map(({ type }) => type)).toEqual([
    'timer.cancel',
    'timer.cancel',
    'provider.close',
    'process.cleanup',
  ]);
});

test('wall deadline remains one-shot and produces a durable wall timeout terminal', () => {
  let transition = reduceSession(idleSessionState(), timerCommand(1, 'wall_clock'));
  const cleanup = effectOf(transition, 'process.cleanup');
  transition = reduceSession(transition.state, {
    correlation: cleanup.correlation,
    observedAt: '2026-03-21T00:01:00.000Z',
    observedAtMs: 60_000,
    type: 'process.cleanup.confirmed',
  });
  const remove = effectOf(transition, 'persistence.remove');
  transition = reduceSession(transition.state, {
    correlation: remove.correlation,
    observedAt: '2026-03-21T00:01:00.000Z',
    observedAtMs: 60_000,
    result: { state: 'not_owner' },
    type: 'persistence.applied',
  });
  const event = effectOf(transition, 'event.append');
  expect(event.event).toMatchObject({ outcome: 'wall_clock_timeout' });
  transition = reduceSession(transition.state, {
    correlation: event.correlation,
    observedAt: '2026-03-21T00:01:00.000Z',
    observedAtMs: 60_000,
    result: { state: 'appended' },
    type: 'event.applied',
  });
  const publication = effectOf(transition, 'output.publish');
  transition = reduceSession(transition.state, {
    correlation: publication.correlation,
    observedAt: '2026-03-21T00:01:00.000Z',
    observedAtMs: 60_000,
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
  expect(transition.state).toMatchObject({
    error: { code: 'revo.agent.timeout' },
    status: 'timed_out',
  });
});
