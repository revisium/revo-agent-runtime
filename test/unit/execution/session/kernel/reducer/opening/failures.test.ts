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

const fault = {
  code: 'revo.agent.active_state_failed',
  message: 'failed',
  phase: 'session_opening',
  retryable: false,
} as const;

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

const outcomeBase = (effect: SessionEffect) => ({
  correlation: effect.correlation,
  observedAt: outcomeTime,
  observedAtMs: outcomeTimeMs,
});

const advanceToSavingProcess = (): SessionTransition => {
  const command = sessionOpeningCommand();
  let transition = reduceSession(createOpeningSessionState(command), command);
  const accepted = effectOf(transition, 'event.append');
  transition = reduceSession(transition.state, {
    ...outcomeBase(accepted),
    result: { state: 'appended' },
    type: 'event.applied',
  });
  const preparation = effectOf(transition, 'opening.prepare');
  transition = reduceSession(transition.state, {
    ...outcomeBase(preparation),
    preparationId: 'preparation_01',
    type: 'opening.preparation.succeeded',
  });
  const start = effectOf(transition, 'process.start');
  return reduceSession(transition.state, {
    ...outcomeBase(start),
    process: sessionProcess,
    processResourceId: 'process_01',
    type: 'process.started',
  });
};

const advanceToProviderOpen = (): SessionTransition => {
  const saving = advanceToSavingProcess();
  const save = effectOf(saving, 'persistence.save');
  return reduceSession(saving.state, {
    ...outcomeBase(save),
    result: { state: 'applied' },
    type: 'persistence.applied',
  });
};

test('cleans a process after a definitive active-state save failure', () => {
  const saving = advanceToSavingProcess();
  const save = effectOf(saving, 'persistence.save');
  let transition = reduceSession(saving.state, {
    ...outcomeBase(save),
    fault,
    type: 'persistence.failed',
  });

  expect(transition.state).toMatchObject({
    progress: { stage: 'cleaning_process' },
    status: 'opening',
  });
  expect(transition.effects.map(({ type }) => type)).toEqual(['process.cleanup']);

  const cleanup = effectOf(transition, 'process.cleanup');
  transition = reduceSession(transition.state, {
    ...outcomeBase(cleanup),
    type: 'process.cleanup.confirmed',
  });
  expect(transition.state.status).toBe('failed');
  expect(transition.effects.map(({ type }) => type)).not.toContain('persistence.remove');
});

test('removes saved state after provider opening fails', () => {
  const opening = advanceToProviderOpen();
  const provider = effectOf(opening, 'provider.open');
  let transition = reduceSession(opening.state, {
    ...outcomeBase(provider),
    fault,
    type: 'provider.open_failed',
  });
  const cleanup = effectOf(transition, 'process.cleanup');
  transition = reduceSession(transition.state, {
    ...outcomeBase(cleanup),
    type: 'process.cleanup.confirmed',
  });
  expect(transition.state).toMatchObject({
    progress: { stage: 'removing_state' },
    status: 'opening',
  });
  expect(transition.effects.map(({ type }) => type)).toEqual(['persistence.remove']);

  const remove = effectOf(transition, 'persistence.remove');
  transition = reduceSession(transition.state, {
    ...outcomeBase(remove),
    result: { state: 'applied' },
    type: 'persistence.applied',
  });
  expect(transition.state.status).toBe('failed');
  expect(transition.effects.map(({ type }) => type)).toContain('public.reject');
});

test('reports uncertain cleanup without pretending the session is terminal', () => {
  const opening = advanceToProviderOpen();
  const provider = effectOf(opening, 'provider.open');
  let transition = reduceSession(opening.state, {
    ...outcomeBase(provider),
    fault,
    type: 'provider.open_timed_out',
  });
  const cleanup = effectOf(transition, 'process.cleanup');
  transition = reduceSession(transition.state, {
    ...outcomeBase(cleanup),
    fault: { ...fault, code: 'revo.agent.process_cleanup_failed' },
    type: 'process.cleanup.uncertain',
  });

  expect(transition.state.status).toBe('cleanup_uncertain');
  expect(transition.effects.map(({ type }) => type)).toContain('public.reject');
});

test('preserves uncertainty when an active-state save cannot be observed', () => {
  const saving = advanceToSavingProcess();
  const save = effectOf(saving, 'persistence.save');
  let transition = reduceSession(saving.state, {
    ...outcomeBase(save),
    fault,
    type: 'persistence.unknown',
  });
  const cleanup = effectOf(transition, 'process.cleanup');
  transition = reduceSession(transition.state, {
    ...outcomeBase(cleanup),
    type: 'process.cleanup.confirmed',
  });

  expect(transition.state.status).toBe('cleanup_uncertain');
  expect(transition.effects.map(({ type }) => type)).not.toContain('persistence.remove');
});
