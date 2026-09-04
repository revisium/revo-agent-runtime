import { expect, test } from 'vitest';

import type { SessionEffect } from '../../../../../../src/execution/session/kernel/effect/session-effect.js';
import { createOpeningSessionState } from '../../../../../../src/execution/session/kernel/reducer/opening.js';
import { reduceSession } from '../../../../../../src/execution/session/kernel/reducer/reduce.js';
import type { SessionTransition } from '../../../../../../src/execution/session/kernel/reducer/transition.js';
import {
  outcomeTime,
  outcomeTimeMs,
  sessionCapabilities,
  sessionOpeningCommand,
  sessionProcess,
} from '../../../../../support/session/builders/kernel/opening.js';

const effectOf = <Type extends SessionEffect['type']>(
  transition: SessionTransition,
  type: Type,
): Extract<SessionEffect, { readonly type: Type }> => {
  const found = transition.effects.find(
    (effect): effect is Extract<SessionEffect, { readonly type: Type }> => effect.type === type,
  );
  if (found === undefined) throw new Error(`Missing ${type} effect.`);
  return found;
};

test.each(['fresh', 'resume'] as const)('opens a %s session through durable stages', (mode) => {
  const command = sessionOpeningCommand(mode);
  let transition = reduceSession(createOpeningSessionState(command), command);

  expect(transition.effects.map(({ type }) => type)).toEqual([
    'event.append',
    'timer.schedule',
    'timer.schedule',
  ]);
  const accepted = effectOf(transition, 'event.append');
  expect(accepted.event).toMatchObject({
    resumed: mode === 'resume',
    type: 'session.accepted',
  });
  expect(accepted.expected.kind).toBe(mode === 'resume' ? 'hibernation_token' : 'empty');

  transition = reduceSession(transition.state, {
    correlation: accepted.correlation,
    observedAt: outcomeTime,
    observedAtMs: outcomeTimeMs,
    result: { state: 'appended' },
    type: 'event.applied',
  });
  expect(transition.effects.map(({ type }) => type)).toEqual(['opening.prepare']);

  const preparation = effectOf(transition, 'opening.prepare');
  transition = reduceSession(transition.state, {
    correlation: preparation.correlation,
    observedAt: outcomeTime,
    observedAtMs: outcomeTimeMs,
    preparationId: 'preparation_01',
    type: 'opening.preparation.succeeded',
  });
  expect(transition.effects.map(({ type }) => type)).toEqual(['process.start']);

  const start = effectOf(transition, 'process.start');
  transition = reduceSession(transition.state, {
    correlation: start.correlation,
    observedAt: outcomeTime,
    observedAtMs: outcomeTimeMs,
    process: sessionProcess,
    processResourceId: 'process_01',
    type: 'process.started',
  });
  expect(transition.effects.map(({ type }) => type)).toEqual(['persistence.save']);

  const save = effectOf(transition, 'persistence.save');
  transition = reduceSession(transition.state, {
    correlation: save.correlation,
    observedAt: outcomeTime,
    observedAtMs: outcomeTimeMs,
    result: { state: 'applied' },
    type: 'persistence.applied',
  });
  expect(transition.effects.map(({ type }) => type)).toEqual(['provider.open']);

  const open = effectOf(transition, 'provider.open');
  transition = reduceSession(transition.state, {
    capabilities: sessionCapabilities,
    correlation: open.correlation,
    observedAt: outcomeTime,
    observedAtMs: outcomeTimeMs,
    providerResourceId: 'provider_01',
    type: 'provider.opened',
  });
  const opened = effectOf(transition, 'event.append');
  expect(opened.event).toMatchObject({ resumed: mode === 'resume', type: 'session.opened' });

  transition = reduceSession(transition.state, {
    correlation: opened.correlation,
    observedAt: outcomeTime,
    observedAtMs: outcomeTimeMs,
    result: { state: 'appended' },
    type: 'event.applied',
  });
  expect(transition.state.status).toBe('idle');
  expect(transition.effects.map(({ type }) => type)).toEqual([
    'timer.cancel',
    'timer.schedule',
    'public.resolve',
  ]);
});

test.each(['event.failed', 'event.unknown'] as const)(
  'fails closed when accepted append returns %s',
  (type) => {
    const command = sessionOpeningCommand();
    const started = reduceSession(createOpeningSessionState(command), command);
    const append = effectOf(started, 'event.append');
    const transition = reduceSession(started.state, {
      correlation: append.correlation,
      fault: {
        code: 'revo.agent.event_sink_failed',
        message: 'not durable',
        phase: 'session_delivery',
        retryable: false,
      },
      observedAt: outcomeTime,
      observedAtMs: outcomeTimeMs,
      type,
    });

    expect(transition.state.status).toBe('failed');
    expect(transition.effects.map(({ type: effectType }) => effectType)).not.toContain(
      'process.start',
    );
    expect(transition.effects.map(({ type: effectType }) => effectType)).toContain('public.reject');
  },
);
