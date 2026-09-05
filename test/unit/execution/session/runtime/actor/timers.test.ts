import { describe, expect, test } from 'vitest';

import { reduceSession } from '../../../../../../src/execution/session/kernel/reducer/reduce.js';
import { SessionActor } from '../../../../../../src/execution/session/runtime/actor/session-actor.js';
import {
  SessionEffectDispatcher,
  type SessionEffectInterpreter,
} from '../../../../../../src/execution/session/runtime/effects/dispatcher.js';
import type {
  ClockReading,
  ScheduledTask,
  SessionClock,
} from '../../../../../../src/execution/session/runtime/timing/clock.js';
import { idleSessionState } from '../../../../../support/session/builders/kernel/session-state.js';

class ManualClock implements SessionClock {
  #now = 1_000;
  readonly tasks: Array<{ cancelled: boolean; deadline: number; run: () => void }> = [];

  now(): ClockReading {
    return { iso: new Date(this.#now).toISOString(), milliseconds: this.#now };
  }

  schedule(delayMs: number, run: () => void): ScheduledTask {
    const task = { cancelled: false, deadline: this.#now + delayMs, run };
    this.tasks.push(task);
    return { cancel: () => (task.cancelled = true) };
  }

  advanceTo(milliseconds: number): void {
    this.#now = milliseconds;
    for (const task of this.tasks)
      if (!task.cancelled && task.deadline <= milliseconds) {
        task.cancelled = true;
        task.run();
      }
  }
}

describe('actor timer reconciliation with the real kernel', () => {
  test('fires the current idle generation and cancels the stale wall timer on terminal entry', async () => {
    const clock = new ManualClock();
    const effects: string[] = [];
    const interpreters: SessionEffectInterpreter[] = [
      {
        execute: (effect) => {
          if (effect.type !== 'provider.close') throw new Error('Expected provider close.');
          effects.push(`${effect.type}:${effect.providerResourceId}`);
        },
        type: 'provider.close',
      },
      {
        execute: (effect, output) => {
          effects.push(effect.type);
          const now = clock.now();
          output.outcome({
            correlation: effect.correlation,
            observedAt: now.iso,
            observedAtMs: now.milliseconds,
            type: 'process.cleanup.confirmed',
          });
        },
        type: 'process.cleanup',
      },
      {
        execute: (effect, output) => {
          effects.push(effect.type);
          const now = clock.now();
          output.outcome({
            correlation: effect.correlation,
            observedAt: now.iso,
            observedAtMs: now.milliseconds,
            result: { state: 'applied' },
            type: 'persistence.applied',
          });
        },
        type: 'persistence.remove',
      },
      {
        execute: (effect, output) => {
          effects.push(effect.type);
          const now = clock.now();
          output.outcome({
            correlation: effect.correlation,
            observedAt: now.iso,
            observedAtMs: now.milliseconds,
            result: { state: 'appended' },
            type: 'event.applied',
          });
        },
        type: 'event.append',
      },
      {
        execute: (effect, output) => {
          effects.push(effect.type);
          const now = clock.now();
          output.outcome({
            correlation: effect.correlation,
            observedAt: now.iso,
            observedAtMs: now.milliseconds,
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
        },
        type: 'output.publish',
      },
    ];
    const actor = new SessionActor({
      clock,
      dispatcher: new SessionEffectDispatcher(interpreters),
      initialState: idleSessionState(),
      reducer: reduceSession,
    });

    expect(clock.tasks).toHaveLength(2);
    clock.advanceTo(11_000);
    await actor.whenQuiescent();

    expect(actor.state).toMatchObject({
      error: { code: 'revo.agent.timeout', details: { timer: 'idle' } },
      status: 'timed_out',
    });
    expect(effects).toEqual([
      'provider.close:provider_01',
      'process.cleanup',
      'persistence.remove',
      'event.append',
      'output.publish',
    ]);
    expect(clock.tasks.every(({ cancelled }) => cancelled)).toBe(true);

    clock.advanceTo(61_000);
    expect(effects).toHaveLength(5);
    expect(actor.state.status).toBe('timed_out');
  });
});
