import { setTimeout as delay } from 'node:timers/promises';

import { expect, test, vi } from 'vitest';

import { NodeMonotonicInvocationClock } from '../../../src/platform/clock/index.js';

test('reports a safe-integer monotonic reading from its construction origin', () => {
  const clock = new NodeMonotonicInvocationClock();
  const first = clock.now();
  const second = clock.now();
  expect(Number.isSafeInteger(first)).toBe(true);
  expect(first).toBeLessThan(1_000);
  expect(second).toBeGreaterThanOrEqual(first);
});

test('stays monotonic across a backward wall-clock jump and advances deterministically', () => {
  vi.useFakeTimers();
  try {
    const clock = new NodeMonotonicInvocationClock();
    expect(clock.now()).toBe(0);
    vi.setSystemTime(Date.now() - 3_600_000);
    expect(clock.now()).toBeGreaterThanOrEqual(0);
    vi.advanceTimersByTime(5_000);
    expect(clock.now()).toBe(5_000);
  } finally {
    vi.useRealTimers();
  }
});

test('schedule invokes the callback and the canceller prevents it', async () => {
  const clock = new NodeMonotonicInvocationClock();
  await new Promise<void>((resolve) => clock.schedule(5, resolve));

  let called = false;
  clock.schedule(5, () => {
    called = true;
  })();
  await delay(15);
  expect(called).toBe(false);
});

test('schedule unrefs its timer', () => {
  const original = globalThis.setTimeout;
  let captured: ReturnType<typeof setTimeout> | undefined;
  const spy = vi
    .spyOn(globalThis, 'setTimeout')
    .mockImplementation((callback, delayMs, ...args) => {
      captured = original(callback, delayMs, ...args);
      return captured;
    });
  try {
    const clock = new NodeMonotonicInvocationClock();
    const cancel = clock.schedule(10_000, () => undefined);
    expect(captured).toBeDefined();
    expect(captured?.hasRef()).toBe(false);
    cancel();
  } finally {
    spy.mockRestore();
  }
});
