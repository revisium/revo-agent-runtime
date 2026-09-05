import { describe, expect, test } from 'vitest';

import type { PublicSessionCommand } from '../../../../../../src/execution/session/kernel/command/public.js';
import type { SessionReducer } from '../../../../../../src/execution/session/kernel/reducer/transition.js';
import { SessionActor } from '../../../../../../src/execution/session/runtime/actor/session-actor.js';
import {
  type InterpretedSessionEffect,
  SessionEffectDispatcher,
  type SessionEffectInterpreter,
} from '../../../../../../src/execution/session/runtime/effects/dispatcher.js';
import type { SessionEffectOutput } from '../../../../../../src/execution/session/runtime/effects/outcomes.js';
import { MAX_CONCURRENT_EFFECTS } from '../../../../../../src/execution/session/runtime/mailbox/credits.js';
import type { SessionClock } from '../../../../../../src/execution/session/runtime/timing/clock.js';
import { sessionOpeningCommand } from '../../../../../support/session/builders/kernel/opening.js';
import { idleSessionState } from '../../../../../support/session/builders/kernel/session-state.js';
import { mandatoryOutcomeCases } from '../../../../../support/session/runtime/effects/outcome-cases.js';

const observed = { observedAt: '2026-09-05T00:00:00.000Z', observedAtMs: 1_000 } as const;
const clock: SessionClock = {
  now: () => ({ iso: observed.observedAt, milliseconds: observed.observedAtMs }),
  schedule: () => ({ cancel: () => undefined }),
};
const seed: PublicSessionCommand = {
  ...observed,
  call: { callId: 'seed', epoch: 1, sessionId: 'session_01' },
  type: 'session.close',
};
const ordinary = (index: number): PublicSessionCommand => ({
  ...observed,
  call: { callId: `ordinary_${index}`, epoch: 1, sessionId: 'session_01' },
  checkpointId: `checkpoint_${index}`,
  type: 'session.checkpoint',
});

describe('reserved effect outcomes', () => {
  test.each(mandatoryOutcomeCases)(
    'delivers $label completion through saturated ordinary traffic',
    async ({ effect, outcome }) => {
      const observedCommands: string[] = [];
      const reducer: SessionReducer = (state, command) => {
        observedCommands.push(command.type);
        return command.type === 'session.close'
          ? { effects: [effect], state }
          : { effects: [], state };
      };
      let actor: SessionActor;
      const interpreter = {
        execute: (_effect: InterpretedSessionEffect, output: SessionEffectOutput) => {
          for (let index = 0; index < 256; index += 1) actor.dispatch(ordinary(index));
          output.outcome(outcome);
        },
        type: effect.type,
      } satisfies SessionEffectInterpreter;
      actor = new SessionActor({
        clock,
        dispatcher: new SessionEffectDispatcher([interpreter]),
        initialState: idleSessionState(),
        reducer,
      });

      actor.dispatch(seed);
      await actor.whenQuiescent();

      expect(observedCommands.at(-1)).toBe(outcome.type);
      expect(observedCommands).toHaveLength(258);
      expect(actor.activeEffects).toBe(0);
    },
  );

  test('does not start a transition whose mandatory outcome credit cannot be reserved', () => {
    const observedCommands: string[] = [];
    const occupyingEffects = Array.from({ length: MAX_CONCURRENT_EFFECTS }, (_, index) => ({
      correlation: { effectId: `occupying_${index}`, epoch: 1, sessionId: 'session_01' },
      opening: sessionOpeningCommand().opening,
      timeoutMs: 100,
      type: 'opening.prepare' as const,
    }));
    const overflowEffect = {
      correlation: { effectId: 'overflow_effect', epoch: 1, sessionId: 'session_01' },
      preparationId: 'preparation_01',
      timeoutMs: 100,
      type: 'process.start' as const,
    };
    const reducer: SessionReducer = (state, command) => {
      observedCommands.push(command.type);
      if (command.type === 'session.close') return { effects: occupyingEffects, state };
      if (command.type === 'session.checkpoint') return { effects: [overflowEffect], state };
      return { effects: [], state };
    };
    let occupyingStarts = 0;
    let overflowStarts = 0;
    const dispatcher = new SessionEffectDispatcher([
      {
        execute: () => {
          occupyingStarts += 1;
        },
        type: 'opening.prepare',
      },
      {
        execute: () => {
          overflowStarts += 1;
        },
        type: 'process.start',
      },
    ]);
    const actor = new SessionActor({
      clock,
      dispatcher,
      initialState: idleSessionState(),
      reducer,
    });

    actor.dispatch(seed);
    actor.dispatch(ordinary(999));

    expect(occupyingStarts).toBe(MAX_CONCURRENT_EFFECTS);
    expect(overflowStarts).toBe(0);
    expect(observedCommands).toEqual(['session.close', 'session.checkpoint', 'process.failed']);
    expect(actor.activeEffects).toBe(MAX_CONCURRENT_EFFECTS);
  });
});
