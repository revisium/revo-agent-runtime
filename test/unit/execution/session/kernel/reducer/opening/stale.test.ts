import { expect, test } from 'vitest';

import type { SessionEffect } from '../../../../../../../src/execution/session/kernel/effect/session-effect.js';
import { createOpeningSessionState } from '../../../../../../../src/execution/session/kernel/reducer/opening.js';
import { reduceSession } from '../../../../../../../src/execution/session/kernel/reducer/reduce.js';
import type { SessionTransition } from '../../../../../../../src/execution/session/kernel/reducer/transition.js';
import {
  outcomeTime,
  outcomeTimeMs,
  sessionOpeningCommand,
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

test('stale and unrelated commands are no-ops while opening', () => {
  const command = sessionOpeningCommand();
  const started = reduceSession(createOpeningSessionState(command), command);
  const event = effectOf(started, 'event.append');
  const preparing = reduceSession(started.state, {
    correlation: event.correlation,
    observedAt: outcomeTime,
    observedAtMs: outcomeTimeMs,
    result: { state: 'appended' },
    type: 'event.applied',
  });
  const preparation = effectOf(preparing, 'opening.prepare');
  const stale = reduceSession(preparing.state, {
    correlation: { ...preparation.correlation, effectId: 'stale' },
    observedAt: outcomeTime,
    observedAtMs: outcomeTimeMs,
    preparationId: 'preparation_01',
    type: 'opening.preparation.succeeded',
  });
  expect(stale).toEqual({ effects: [], state: preparing.state });

  const unrelated = reduceSession(preparing.state, {
    correlation: { effectId: 'irrelevant', epoch: 1, sessionId: 'session_01', turnId: 'turn_01' },
    message: 'ignored',
    observedAt: outcomeTime,
    observedAtMs: outcomeTimeMs,
    type: 'provider.progress',
  });
  expect(unrelated).toEqual({ effects: [], state: preparing.state });

  const wrongMode = reduceSession(
    createOpeningSessionState(command),
    sessionOpeningCommand('resume'),
  );
  expect(wrongMode.effects).toEqual([]);
});
