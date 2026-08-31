import { afterEach, expect, test, vi } from 'vitest';

import { ConfigurationDeadline } from '../../../../src/execution/configuration/deadline.js';

afterEach(() => {
  vi.useRealTimers();
});

test('commits an already-requested cancellation once and exposes it to every observer', async () => {
  vi.useFakeTimers();
  const external = new AbortController();
  external.abort();
  const deadline = new ConfigurationDeadline(external.signal, 100, 50);

  deadline.activity();
  expect(deadline.current()).toBe('cancelled');
  await expect(deadline.completion()).resolves.toBe('cancelled');
  expect(deadline.signal.aborted).toBe(true);
  external.abort();
  deadline.finish(external.signal);
});

test('refreshes idle time without weakening the wall clock and clears both timers on finish', async () => {
  vi.useFakeTimers();
  const external = new AbortController();
  const deadline = new ConfigurationDeadline(external.signal, 100, 40);

  deadline.activity();
  await vi.advanceTimersByTimeAsync(20);
  deadline.activity();
  await vi.advanceTimersByTimeAsync(39);
  expect(deadline.current()).toBeUndefined();
  await vi.advanceTimersByTimeAsync(1);
  await expect(deadline.completion()).resolves.toBe('timed_out');
  external.abort();
  deadline.finish(external.signal);
});

test('finishes cleanly before any activity and commits an external cancellation', async () => {
  vi.useFakeTimers();
  const external = new AbortController();
  const finished = new ConfigurationDeadline(external.signal, 100, 50);
  finished.finish(external.signal);
  await vi.runAllTimersAsync();
  expect(finished.current()).toBeUndefined();

  const cancelled = new ConfigurationDeadline(external.signal, 100, 50);
  external.abort();
  await expect(cancelled.completion()).resolves.toBe('cancelled');
  cancelled.finish(external.signal);
});
