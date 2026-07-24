import type { InvocationExecutionPorts } from '../../../src/runtime/execution/index.js';

interface ScheduledAction {
  readonly dueAt: number;
  readonly registrationOrder: number;
  readonly callback: () => void;
  active: boolean;
}

const requireSafeInteger = (value: number, name: string): void => {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${name} must be a finite safe integer`);
  }
};

const requireNonNegativeSafeInteger = (value: number, name: string): void => {
  requireSafeInteger(value, name);
  if (value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
};

type InvocationClockPort = InvocationExecutionPorts['clock'];

export class FakeInvocationClock implements InvocationClockPort {
  private readonly scheduledActions: ScheduledAction[] = [];
  private nowMs: number;
  private nextRegistrationOrder = 1;

  constructor({ initialNowMs }: Readonly<{ initialNowMs: number }>) {
    requireSafeInteger(initialNowMs, 'initialNowMs');
    this.nowMs = initialNowMs;
  }

  now(): number {
    return this.nowMs;
  }

  schedule(delayMs: number, callback: () => void): () => void {
    requireNonNegativeSafeInteger(delayMs, 'delayMs');
    const dueAt = this.safeSum(this.nowMs, delayMs);
    const action: ScheduledAction = {
      dueAt,
      registrationOrder: this.nextRegistrationOrder,
      callback,
      active: true,
    };
    this.nextRegistrationOrder += 1;
    this.scheduledActions.push(action);

    return () => {
      action.active = false;
    };
  }

  advanceBy(deltaMs: number): void {
    requireNonNegativeSafeInteger(deltaMs, 'deltaMs');
    const target = this.safeSum(this.nowMs, deltaMs);

    for (;;) {
      const action = this.nextActiveActionAtOrBefore(target);
      if (action === undefined) {
        break;
      }

      this.nowMs = action.dueAt;
      this.fire(action);
    }

    this.nowMs = target;
  }

  fireNext(): void {
    const action = this.nextActiveAction();
    if (action === undefined) {
      throw new Error('No scheduled action');
    }

    this.nowMs = action.dueAt;
    this.fire(action);
  }

  pendingActionCount(): number {
    return this.scheduledActions.filter((action) => action.active).length;
  }

  private safeSum(left: number, right: number): number {
    const sum = left + right;
    requireSafeInteger(sum, 'Virtual time');
    return sum;
  }

  private nextActiveActionAtOrBefore(target: number): ScheduledAction | undefined {
    const action = this.nextActiveAction();
    if (action === undefined || action.dueAt > target) {
      return undefined;
    }

    return action;
  }

  private nextActiveAction(): ScheduledAction | undefined {
    let next: ScheduledAction | undefined;
    for (const action of this.scheduledActions) {
      if (!action.active) {
        continue;
      }
      if (
        next === undefined ||
        action.dueAt < next.dueAt ||
        (action.dueAt === next.dueAt && action.registrationOrder < next.registrationOrder)
      ) {
        next = action;
      }
    }

    return next;
  }

  private fire(action: ScheduledAction): void {
    action.active = false;
    action.callback();
  }
}
