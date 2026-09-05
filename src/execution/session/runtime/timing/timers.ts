import type { TimerCommand } from '../../kernel/command/timer.js';
import type { SessionTimerState } from '../../kernel/model/session-state.js';
import type { ScheduledTask, SessionClock } from './clock.js';

export interface SessionTimerDeclarations {
  readonly sessionId: string;
  readonly epoch: number;
  readonly timers: readonly SessionTimerState[];
}

interface ArmedTimer {
  readonly declaration: SessionTimerState;
  readonly task: ScheduledTask;
}

const sameDeclaration = (left: SessionTimerState, right: SessionTimerState): boolean =>
  left.deadlineMs === right.deadlineMs &&
  left.generation === right.generation &&
  left.kind === right.kind &&
  left.timerId === right.timerId;

export class SessionTimerRegistry {
  readonly #armed = new Map<string, ArmedTimer>();

  constructor(
    private readonly clock: SessionClock,
    private readonly emit: (command: TimerCommand) => void,
  ) {}

  get size(): number {
    return this.#armed.size;
  }

  reconcile(state: SessionTimerDeclarations): void {
    const desired = new Map(state.timers.map((timer) => [timer.timerId, timer]));
    for (const [timerId, armed] of this.#armed) {
      const next = desired.get(timerId);
      if (next === undefined || !sameDeclaration(armed.declaration, next)) this.#cancel(timerId);
    }
    for (const timer of state.timers) {
      if (this.#armed.has(timer.timerId)) continue;
      this.#arm(state, timer);
    }
  }

  cancelAll(): void {
    for (const timerId of this.#armed.keys()) this.#cancel(timerId);
  }

  #arm(state: SessionTimerDeclarations, timer: SessionTimerState): void {
    const delayMs = Math.max(0, timer.deadlineMs - this.clock.now().milliseconds);
    let task: ScheduledTask;
    const run = (): void => {
      const armed = this.#armed.get(timer.timerId);
      if (armed?.task !== task) return;
      this.#armed.delete(timer.timerId);
      const now = this.clock.now();
      this.emit({
        correlation: {
          effectId: `${state.sessionId}:${state.epoch}:timer:${timer.timerId}:${timer.generation}`,
          epoch: state.epoch,
          sessionId: state.sessionId,
        },
        firedAt: now.iso,
        firedAtMs: now.milliseconds,
        generation: timer.generation,
        kind: timer.kind,
        timerId: timer.timerId,
        type: 'timer.fired',
      });
    };
    task = this.clock.schedule(delayMs, run);
    this.#armed.set(timer.timerId, { declaration: timer, task });
  }

  #cancel(timerId: string): void {
    const armed = this.#armed.get(timerId);
    if (armed === undefined) return;
    this.#armed.delete(timerId);
    armed.task.cancel();
  }
}
