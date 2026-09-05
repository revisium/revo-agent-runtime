import { expect, test } from 'vitest';

import type { SessionEffect } from '../../../../../../../src/execution/session/kernel/effect/session-effect.js';
import { createOpeningSessionState } from '../../../../../../../src/execution/session/kernel/reducer/opening.js';
import { reduceSession } from '../../../../../../../src/execution/session/kernel/reducer/reduce.js';
import type { SessionTransition } from '../../../../../../../src/execution/session/kernel/reducer/transition.js';
import {
  outcomeTime,
  outcomeTimeMs,
  sessionCapabilities,
  sessionOpeningCommand,
  sessionProcess,
} from '../../../../../../support/session/builders/kernel/opening.js';

const fault = {
  code: 'revo.agent.internal',
  message: 'failed',
  phase: 'session_opening',
  retryable: false,
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
const base = (effect: SessionEffect) => ({
  correlation: effect.correlation,
  observedAt: outcomeTime,
  observedAtMs: outcomeTimeMs,
});

const preparing = () => {
  const command = sessionOpeningCommand();
  const started = reduceSession(createOpeningSessionState(command), command);
  const event = effectOf(started, 'event.append');
  return reduceSession(started.state, {
    ...base(event),
    result: { state: 'appended' },
    type: 'event.timed_out_then_applied',
  });
};
const startingProcess = () => {
  const started = preparing();
  const effect = effectOf(started, 'opening.prepare');
  return reduceSession(started.state, {
    ...base(effect),
    preparationId: 'preparation_01',
    type: 'opening.preparation.succeeded',
  });
};
const savingProcess = () => {
  const started = startingProcess();
  const effect = effectOf(started, 'process.start');
  return reduceSession(started.state, {
    ...base(effect),
    process: sessionProcess,
    processResourceId: 'process_01',
    type: 'process.started',
  });
};
const openingProvider = () => {
  const started = savingProcess();
  const effect = effectOf(started, 'persistence.save');
  return reduceSession(started.state, {
    ...base(effect),
    result: { state: 'applied' },
    type: 'persistence.applied',
  });
};

test.each([
  'opening.preparation.rejected',
  'opening.preparation.failed',
  'opening.preparation.timed_out',
] as const)('%s fails before process ownership', (type) => {
  const started = preparing();
  const transition = reduceSession(started.state, {
    ...base(effectOf(started, 'opening.prepare')),
    fault,
    type,
  });
  expect(transition.state.status).toBe('failed');
});

test.each(['process.failed', 'process.timed_out'] as const)('%s fails before ownership', (type) => {
  const started = startingProcess();
  const transition = reduceSession(started.state, {
    ...base(effectOf(started, 'process.start')),
    fault,
    type,
  });
  expect(transition.state.status).toBe('failed');
});

test('active-state ownership refusal cleans the newly owned process', () => {
  const started = savingProcess();
  const transition = reduceSession(started.state, {
    ...base(effectOf(started, 'persistence.save')),
    result: { state: 'not_owner' },
    type: 'persistence.applied',
  });
  expect(transition.state).toMatchObject({ progress: { stage: 'cleaning_process' } });
});

test('late applied active-state save resumes provider opening', () => {
  const started = savingProcess();
  const transition = reduceSession(started.state, {
    ...base(effectOf(started, 'persistence.save')),
    result: { state: 'applied' },
    type: 'persistence.late_applied',
  });
  expect(effectOf(transition, 'provider.open')).toBeDefined();
});

test.each(['provider.open_failed', 'provider.open_timed_out'] as const)(
  '%s cleans the process and saved state',
  (type) => {
    const started = openingProvider();
    const transition = reduceSession(started.state, {
      ...base(effectOf(started, 'provider.open')),
      fault,
      type,
    });
    expect(transition.state).toMatchObject({ progress: { afterCleanup: 'remove_state' } });
  },
);

test('event conflicts and stale event outcomes fail safely', () => {
  const command = sessionOpeningCommand();
  const started = reduceSession(createOpeningSessionState(command), command);
  const event = effectOf(started, 'event.append');
  const stale = reduceSession(started.state, {
    correlation: { ...event.correlation, effectId: 'stale' },
    fault,
    observedAt: outcomeTime,
    observedAtMs: outcomeTimeMs,
    type: 'event.timed_out_then_failed',
  });
  expect(stale).toEqual({ effects: [], state: started.state });
  const conflict = reduceSession(started.state, {
    ...base(event),
    result: { state: 'conflict' },
    type: 'event.applied',
  });
  expect(conflict.state).toMatchObject({
    error: { code: 'revo.agent.event_conflict' },
    status: 'failed',
  });
});

test.each(['persistence.failed', 'persistence.late_failed', 'persistence.unknown'] as const)(
  '%s while removing saved opening state preserves uncertainty',
  (type) => {
    const opened = openingProvider();
    let transition = reduceSession(opened.state, {
      ...base(effectOf(opened, 'provider.open')),
      fault,
      type: 'provider.open_failed',
    });
    transition = reduceSession(transition.state, {
      ...base(effectOf(transition, 'process.cleanup')),
      type: 'process.cleanup.confirmed',
    });
    transition = reduceSession(transition.state, {
      ...base(effectOf(transition, 'persistence.remove')),
      fault,
      type,
    });
    expect(transition.state.status).toBe('cleanup_uncertain');
  },
);

test('successful provider open still emits the negotiated capabilities', () => {
  const started = openingProvider();
  const transition = reduceSession(started.state, {
    ...base(effectOf(started, 'provider.open')),
    capabilities: sessionCapabilities,
    providerResourceId: 'provider_01',
    type: 'provider.opened',
  });
  expect(effectOf(transition, 'event.append').event).toMatchObject({
    capabilities: sessionCapabilities,
  });
});
