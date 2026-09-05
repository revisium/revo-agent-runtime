import { describe, expect, test } from 'vitest';

import type { PublicSessionCommand } from '../../../../../../src/execution/session/kernel/command/public.js';
import type { SessionReducer } from '../../../../../../src/execution/session/kernel/reducer/transition.js';
import { SessionActor } from '../../../../../../src/execution/session/runtime/actor/session-actor.js';
import {
  SessionEffectDispatcher,
  type SessionEffectInterpreter,
} from '../../../../../../src/execution/session/runtime/effects/dispatcher.js';
import type { SessionClock } from '../../../../../../src/execution/session/runtime/timing/clock.js';
import { sessionOpeningCommand } from '../../../../../support/session/builders/kernel/opening.js';
import { idleSessionState } from '../../../../../support/session/builders/kernel/session-state.js';

const clock: SessionClock = {
  now: () => ({ iso: '2026-09-05T00:00:00.000Z', milliseconds: 1_000 }),
  schedule: () => ({ cancel: () => undefined }),
};

const closeCommand = (callId = 'close_01'): PublicSessionCommand => ({
  call: { callId, epoch: 1, sessionId: 'session_01' },
  observedAt: '2026-09-05T00:00:00.000Z',
  observedAtMs: 1_000,
  type: 'session.close',
});

describe('session actor', () => {
  test('replaces state before effect start and serializes a synchronous outcome', async () => {
    const commands: string[] = [];
    const reducer: SessionReducer = (state, command) => {
      commands.push(command.type);
      if (command.type !== 'session.close')
        return { effects: [], state: { ...state, nextEventSequence: state.nextEventSequence + 1 } };
      return {
        effects: [
          {
            correlation: { effectId: 'prepare_01', epoch: 1, sessionId: 'session_01' },
            opening: sessionOpeningCommand().opening,
            timeoutMs: 100,
            type: 'opening.prepare',
          },
        ],
        state: { ...state, nextEffectSequence: state.nextEffectSequence + 1 },
      };
    };
    let actor: SessionActor;
    const interpreter = {
      execute: (effect, output) => {
        expect(actor.state.nextEffectSequence).toBe(11);
        output.outcome({
          correlation: effect.correlation,
          observedAt: '2026-09-05T00:00:00.000Z',
          observedAtMs: 1_000,
          preparationId: 'preparation_01',
          type: 'opening.preparation.succeeded',
        });
      },
      type: 'opening.prepare',
    } satisfies SessionEffectInterpreter;
    actor = new SessionActor({
      clock,
      dispatcher: new SessionEffectDispatcher([interpreter]),
      initialState: idleSessionState(),
      reducer,
    });

    expect(actor.dispatch(closeCommand())).toEqual({ state: 'accepted' });
    await actor.whenQuiescent();

    expect(commands).toEqual(['session.close', 'opening.preparation.succeeded']);
    expect(actor.state.nextEventSequence).toBe(4);
    expect(actor.activeEffects).toBe(0);
  });

  test('contains a synchronously throwing mandatory effect interpreter', async () => {
    const commands: string[] = [];
    const reducer: SessionReducer = (state, command) => {
      commands.push(command.type);
      return command.type === 'session.close'
        ? {
            effects: [
              {
                correlation: { effectId: 'prepare_01', epoch: 1, sessionId: 'session_01' },
                opening: sessionOpeningCommand().opening,
                timeoutMs: 100,
                type: 'opening.prepare',
              },
            ],
            state: { ...state, nextEffectSequence: state.nextEffectSequence + 1 },
          }
        : { effects: [], state };
    };
    const interpreter = {
      execute: () => {
        throw new Error('interpreter failed');
      },
      type: 'opening.prepare',
    } satisfies SessionEffectInterpreter;
    const actor = new SessionActor({
      clock,
      dispatcher: new SessionEffectDispatcher([interpreter]),
      initialState: idleSessionState(),
      reducer,
    });

    actor.dispatch(closeCommand());
    await actor.whenQuiescent();
    expect(commands).toEqual(['session.close', 'opening.preparation.failed']);
    expect(actor.activeEffects).toBe(0);
  });

  test('fails a mandatory effect when no interpreter owns it', async () => {
    const commands: string[] = [];
    const reducer: SessionReducer = (state, command) => {
      commands.push(command.type);
      return command.type === 'session.close'
        ? {
            effects: [
              {
                correlation: { effectId: 'prepare_missing', epoch: 1, sessionId: 'session_01' },
                opening: sessionOpeningCommand().opening,
                timeoutMs: 100,
                type: 'opening.prepare',
              },
            ],
            state,
          }
        : { effects: [], state };
    };
    const actor = new SessionActor({
      clock,
      dispatcher: new SessionEffectDispatcher([]),
      initialState: idleSessionState(),
      reducer,
    });

    actor.dispatch(closeCommand());
    await actor.whenQuiescent();

    expect(commands).toEqual(['session.close', 'opening.preparation.failed']);
    expect(actor.activeEffects).toBe(0);
  });

  test('contains an unowned best-effort effect without manufacturing an outcome', async () => {
    const reducer: SessionReducer = (state, command) =>
      command.type === 'session.close'
        ? {
            effects: [
              {
                correlation: { effectId: 'close_unowned', epoch: 1, sessionId: 'session_01' },
                providerResourceId: 'provider_01',
                reason: 'best effort',
                timeoutMs: 100,
                type: 'provider.close',
              },
            ],
            state,
          }
        : { effects: [], state };
    const actor = new SessionActor({
      clock,
      dispatcher: new SessionEffectDispatcher([]),
      initialState: idleSessionState(),
      reducer,
    });

    actor.dispatch(closeCommand());
    await actor.whenQuiescent();

    expect(actor.activeEffects).toBe(0);
  });
});
