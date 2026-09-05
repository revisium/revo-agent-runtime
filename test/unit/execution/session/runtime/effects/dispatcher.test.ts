import { describe, expect, test } from 'vitest';

import type { SessionEffect } from '../../../../../../src/execution/session/kernel/effect/session-effect.js';
import {
  SessionEffectDispatcher,
  type SessionEffectInterpreter,
} from '../../../../../../src/execution/session/runtime/effects/dispatcher.js';
import type { SessionEffectOutput } from '../../../../../../src/execution/session/runtime/effects/outcomes.js';
import {
  sessionOpeningCommand,
  sessionProcess,
} from '../../../../../support/session/builders/kernel/opening.js';

const output: SessionEffectOutput = {
  offerUpdate: () => 'accepted',
  outcome: () => undefined,
  update: () => Promise.resolve('processed'),
};
const preparation = {
  correlation: { effectId: 'prepare_01', epoch: 1, sessionId: 'session_01' },
  opening: sessionOpeningCommand().opening,
  timeoutMs: 100,
  type: 'opening.prepare',
} satisfies SessionEffect;
const cleanup = {
  correlation: { effectId: 'cleanup_01', epoch: 1, sessionId: 'session_01' },
  process: sessionProcess,
  processResourceId: 'process_01',
  timeoutMs: 100,
  type: 'process.cleanup',
} satisfies SessionEffect;

describe('session effect dispatcher', () => {
  test('routes each discriminant to one narrow interpreter', () => {
    const observed: string[] = [];
    const interpreters: SessionEffectInterpreter[] = [
      {
        execute: (effect, receivedOutput) => {
          expect(receivedOutput).toBe(output);
          observed.push(effect.correlation.effectId);
        },
        type: 'opening.prepare',
      },
      {
        execute: (effect) => {
          if (effect.type !== 'process.cleanup') throw new Error('Expected process cleanup.');
          observed.push(effect.processResourceId);
        },
        type: 'process.cleanup',
      },
    ];
    const dispatcher = new SessionEffectDispatcher(interpreters);

    expect(dispatcher.dispatch(preparation, output)).toBe(true);
    expect(dispatcher.dispatch(cleanup, output)).toBe(true);
    expect(observed).toEqual(['prepare_01', 'process_01']);
  });

  test('reports a missing interpreter and rejects duplicate registrations', () => {
    const interpreter = {
      execute: () => undefined,
      type: 'opening.prepare',
    } satisfies SessionEffectInterpreter;

    expect(new SessionEffectDispatcher([]).dispatch(preparation, output)).toBe(false);
    expect(() => new SessionEffectDispatcher([interpreter, interpreter])).toThrow(
      'Duplicate session effect interpreter: opening.prepare',
    );
  });
});
