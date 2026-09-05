import { describe, expect, test } from 'vitest';

import type {
  ClockReading,
  ScheduledTask,
  SessionClock,
} from '../../../../../../src/execution/session/runtime/timing/clock.js';
import { SessionTimerRegistry } from '../../../../../../src/execution/session/runtime/timing/timers.js';

class ManualClock implements SessionClock {
  #now = 1_000;
  readonly tasks: Array<{ cancelled: boolean; dueAt: number; run: () => void }> = [];

  now(): ClockReading {
    return { iso: new Date(this.#now).toISOString(), milliseconds: this.#now };
  }

  schedule(delayMs: number, run: () => void): ScheduledTask {
    const task = { cancelled: false, dueAt: this.#now + delayMs, run };
    this.tasks.push(task);
    return { cancel: () => (task.cancelled = true) };
  }

  advanceTo(milliseconds: number): void {
    this.#now = milliseconds;
    for (const task of this.tasks)
      if (!task.cancelled && task.dueAt <= milliseconds) {
        task.cancelled = true;
        task.run();
      }
  }
}

const declaration = (generation: number, deadlineMs = 2_000) => ({
  epoch: 3,
  sessionId: 'session_01',
  timers: [{ deadlineMs, generation, kind: 'idle' as const, timerId: 'idle' }],
});

describe('declarative session timers', () => {
  test('arms once and emits the declared generation at the deadline', () => {
    const clock = new ManualClock();
    const commands: unknown[] = [];
    const timers = new SessionTimerRegistry(clock, (command) => commands.push(command));

    timers.reconcile(declaration(1));
    timers.reconcile(declaration(1));
    expect(clock.tasks).toHaveLength(1);

    clock.advanceTo(2_000);

    expect(commands).toEqual([
      {
        correlation: {
          effectId: 'session_01:3:timer:idle:1',
          epoch: 3,
          sessionId: 'session_01',
        },
        firedAt: '1970-01-01T00:00:02.000Z',
        firedAtMs: 2_000,
        generation: 1,
        kind: 'idle',
        timerId: 'idle',
        type: 'timer.fired',
      },
    ]);
    expect(timers.size).toBe(0);
  });

  test('cancels replaced and removed declarations so stale callbacks cannot enter', () => {
    const clock = new ManualClock();
    const commands: unknown[] = [];
    const timers = new SessionTimerRegistry(clock, (command) => commands.push(command));

    timers.reconcile(declaration(1));
    timers.reconcile(declaration(2, 3_000));
    timers.reconcile({ ...declaration(2), timers: [] });
    clock.advanceTo(4_000);

    expect(clock.tasks).toHaveLength(2);
    expect(clock.tasks.every(({ cancelled }) => cancelled)).toBe(true);
    expect(commands).toEqual([]);
    expect(timers.size).toBe(0);
  });
});
