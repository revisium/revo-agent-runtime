import { describe, expect, test } from 'vitest';

import type { PublicSessionCommand } from '../../../../../../src/execution/session/kernel/command/public.js';
import type { SessionReducer } from '../../../../../../src/execution/session/kernel/reducer/transition.js';
import { SessionActor } from '../../../../../../src/execution/session/runtime/actor/session-actor.js';
import {
  SessionEffectDispatcher,
  type SessionEffectInterpreter,
} from '../../../../../../src/execution/session/runtime/effects/dispatcher.js';
import type { SessionClock } from '../../../../../../src/execution/session/runtime/timing/clock.js';
import { idleSessionState } from '../../../../../support/session/builders/kernel/session-state.js';

const observed = { observedAt: '2026-09-05T00:00:00.000Z', observedAtMs: 1_000 } as const;
const fault = {
  code: 'revo.agent.protocol_failed',
  message: 'The controlled effect timed out.',
  phase: 'session_running',
  retryable: false,
} as const;
const clock: SessionClock = {
  now: () => ({ iso: observed.observedAt, milliseconds: observed.observedAtMs }),
  schedule: () => ({ cancel: () => undefined }),
};
const seed: PublicSessionCommand = {
  ...observed,
  call: { callId: 'seed', epoch: 1, sessionId: 'session_01' },
  type: 'session.close',
};

describe('effect outcome re-entry', () => {
  test('keeps a prompt lease after accepted and releases it on the terminal timeout', () => {
    const correlation = {
      effectId: 'prompt_01',
      epoch: 1,
      sessionId: 'session_01',
      turnId: 'turn_01',
    } as const;
    const commands: string[] = [];
    const reducer: SessionReducer = (state, command) => {
      commands.push(command.type);
      return command.type === 'session.close'
        ? {
            effects: [
              {
                correlation,
                input: { prompt: 'continue', turnId: 'turn_01' },
                providerResourceId: 'provider_01',
                timeoutMs: 100,
                type: 'provider.prompt',
              },
            ],
            state,
          }
        : { effects: [], state };
    };
    const prompt = {
      execute: (_effect, output) =>
        output.outcome({ ...observed, correlation, type: 'provider.prompt.accepted' }),
      type: 'provider.prompt',
    } satisfies SessionEffectInterpreter;
    const actor = new SessionActor({
      clock,
      dispatcher: new SessionEffectDispatcher([prompt]),
      initialState: idleSessionState(),
      reducer,
    });

    actor.dispatch(seed);
    expect(actor.activeEffects).toBe(1);

    let output: Parameters<typeof prompt.execute>[1] | undefined;
    const capture = {
      execute: (_effect, effectOutput) => {
        output = effectOutput;
      },
      type: 'provider.prompt',
    } satisfies SessionEffectInterpreter;
    const second = new SessionActor({
      clock,
      dispatcher: new SessionEffectDispatcher([capture]),
      initialState: idleSessionState(),
      reducer,
    });
    second.dispatch(seed);
    if (output === undefined) throw new Error('Prompt output was not captured.');
    output.outcome({ ...observed, correlation, fault, type: 'provider.prompt.timed_out' });
    output.outcome({
      ...observed,
      correlation,
      outcome: { status: 'cancelled' },
      type: 'provider.prompt.completed',
    });

    expect(second.activeEffects).toBe(0);
    expect(commands.slice(-3)).toEqual([
      'session.close',
      'provider.prompt.timed_out',
      'provider.prompt.completed',
    ]);
  });

  test('admits a late process resource and starts explicit cleanup after timeout', async () => {
    const correlation = { effectId: 'process_01', epoch: 1, sessionId: 'session_01' };
    const commands: string[] = [];
    const reducer: SessionReducer = (state, command) => {
      commands.push(command.type);
      if (command.type === 'session.close')
        return {
          effects: [
            {
              correlation,
              preparationId: 'preparation_01',
              timeoutMs: 100,
              type: 'process.start',
            },
          ],
          state,
        };
      if (command.type === 'process.late_started')
        return {
          effects: [
            {
              correlation: { ...correlation, effectId: 'cleanup_01' },
              process: command.process,
              processResourceId: command.processResourceId,
              timeoutMs: 100,
              type: 'process.cleanup',
            },
          ],
          state,
        };
      return { effects: [], state };
    };
    const process = {
      execute: (_effect, output) => {
        output.outcome({ ...observed, correlation, fault, type: 'process.timed_out' });
        output.outcome({
          ...observed,
          correlation,
          process: {
            fingerprint: 'fingerprint',
            pid: 42,
            processGroupId: 42,
            startedAt: observed.observedAt,
          },
          processResourceId: 'late_process',
          type: 'process.late_started',
        });
      },
      type: 'process.start',
    } satisfies SessionEffectInterpreter;
    const cleanup = {
      execute: (effect, output) =>
        output.outcome({
          ...observed,
          correlation: effect.correlation,
          type: 'process.cleanup.confirmed',
        }),
      type: 'process.cleanup',
    } satisfies SessionEffectInterpreter;
    const actor = new SessionActor({
      clock,
      dispatcher: new SessionEffectDispatcher([process, cleanup]),
      initialState: idleSessionState(),
      reducer,
    });

    actor.dispatch(seed);
    await actor.whenQuiescent();

    expect(commands).toEqual([
      'session.close',
      'process.timed_out',
      'process.late_started',
      'process.cleanup.confirmed',
    ]);
    expect(actor.activeEffects).toBe(0);
  });

  test('routes an explicit unknown boundary outcome without leaking its credit', async () => {
    const correlation = { effectId: 'event_01', epoch: 1, sessionId: 'session_01' };
    const commands: string[] = [];
    const reducer: SessionReducer = (state, command) => {
      commands.push(command.type);
      return command.type === 'session.close'
        ? {
            effects: [
              {
                correlation,
                event: {
                  eventId: 'event_01',
                  message: 'progress',
                  observedAt: observed.observedAt,
                  schemaVersion: 'agent-session-event/v1',
                  sequence: 1,
                  sessionId: state.sessionId,
                  streamId: state.streamId,
                  turnId: 'turn_01',
                  type: 'agent.progress',
                },
                expected: { kind: 'empty' },
                timeoutMs: 100,
                type: 'event.append',
              },
            ],
            state,
          }
        : { effects: [], state };
    };
    const event = {
      execute: (_effect, output) =>
        output.outcome({ ...observed, correlation, fault, type: 'event.unknown' }),
      type: 'event.append',
    } satisfies SessionEffectInterpreter;
    const actor = new SessionActor({
      clock,
      dispatcher: new SessionEffectDispatcher([event]),
      initialState: idleSessionState(),
      reducer,
    });

    actor.dispatch(seed);
    await actor.whenQuiescent();

    expect(commands).toEqual(['session.close', 'event.unknown']);
    expect(actor.activeEffects).toBe(0);
  });
});
