import { expect, test } from 'vitest';

import type { SessionEffect } from '../../../../../../../src/execution/session/kernel/effect/session-effect.js';
import { createOpeningSessionState } from '../../../../../../../src/execution/session/kernel/reducer/opening.js';
import { reduceSession } from '../../../../../../../src/execution/session/kernel/reducer/reduce.js';
import type { SessionTransition } from '../../../../../../../src/execution/session/kernel/reducer/transition.js';
import {
  outcomeTime,
  outcomeTimeMs,
  sessionOpeningCommand,
  sessionProcess,
} from '../../../../../../support/session/builders/kernel/opening.js';

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
const timer = (kind: 'opening' | 'wall_clock', generation = 1) => ({
  correlation: { effectId: 'timer_callback', epoch: 1, sessionId: 'session_01' },
  firedAt: outcomeTime,
  firedAtMs: outcomeTimeMs,
  generation,
  kind,
  timerId: `session_01:1:${kind === 'opening' ? 'opening' : 'wall'}`,
  type: 'timer.fired' as const,
});

test('opening deadline fails before process ownership and ignores stale generations', () => {
  const command = sessionOpeningCommand();
  const started = reduceSession(createOpeningSessionState(command), command);
  expect(reduceSession(started.state, timer('opening', 2))).toEqual({
    effects: [],
    state: started.state,
  });
  const failed = reduceSession(started.state, timer('opening'));
  expect(failed.state).toMatchObject({ error: { code: 'revo.agent.timeout' }, status: 'failed' });
});

test('a late process start after opening timeout is always cleaned', () => {
  const command = sessionOpeningCommand();
  const started = reduceSession(createOpeningSessionState(command), command);
  const failed = reduceSession(started.state, timer('opening'));
  const late = reduceSession(failed.state, {
    correlation: { effectId: 'late_start', epoch: 1, sessionId: 'session_01' },
    observedAt: outcomeTime,
    observedAtMs: outcomeTimeMs,
    process: sessionProcess,
    processResourceId: 'late_process',
    type: 'process.late_started',
  });
  expect(effectOf(late, 'process.cleanup')).toMatchObject({ processResourceId: 'late_process' });
});

test('wall deadline after durable process save cleans and removes active state', () => {
  const command = sessionOpeningCommand();
  let transition = reduceSession(createOpeningSessionState(command), command);
  const accepted = effectOf(transition, 'event.append');
  transition = reduceSession(transition.state, {
    correlation: accepted.correlation,
    observedAt: outcomeTime,
    observedAtMs: outcomeTimeMs,
    result: { state: 'appended' },
    type: 'event.applied',
  });
  const preparation = effectOf(transition, 'opening.prepare');
  transition = reduceSession(transition.state, {
    correlation: preparation.correlation,
    observedAt: outcomeTime,
    observedAtMs: outcomeTimeMs,
    preparationId: 'preparation_01',
    type: 'opening.preparation.succeeded',
  });
  const start = effectOf(transition, 'process.start');
  transition = reduceSession(transition.state, {
    correlation: start.correlation,
    observedAt: outcomeTime,
    observedAtMs: outcomeTimeMs,
    process: sessionProcess,
    processResourceId: 'process_01',
    type: 'process.started',
  });
  const save = effectOf(transition, 'persistence.save');
  transition = reduceSession(transition.state, {
    correlation: save.correlation,
    observedAt: outcomeTime,
    observedAtMs: outcomeTimeMs,
    result: { state: 'applied' },
    type: 'persistence.applied',
  });
  transition = reduceSession(transition.state, timer('wall_clock'));
  expect(transition.state).toMatchObject({ progress: { afterCleanup: 'remove_state' } });
});
