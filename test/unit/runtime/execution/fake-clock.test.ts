import { expect, test } from 'vitest';

import { FakeInvocationClock } from '../../../support/execution/fake-clock.js';

test('returns its explicit safe-integer initial time', () => {
  const clock = new FakeInvocationClock({ initialNowMs: -2 });

  expect(clock.now()).toBe(-2);
  expect(() => new FakeInvocationClock({ initialNowMs: 1.5 })).toThrow('initialNowMs');
});

test('rejects invalid delays and virtual-time overflow', () => {
  const clock = new FakeInvocationClock({ initialNowMs: Number.MAX_SAFE_INTEGER });

  expect(() => clock.schedule(-1, () => undefined)).toThrow('delayMs');
  expect(() => clock.schedule(0.5, () => undefined)).toThrow('delayMs');
  expect(() => clock.advanceBy(Number.POSITIVE_INFINITY)).toThrow('deltaMs');
  expect(() => clock.schedule(1, () => undefined)).toThrow('safe integer');
});

test('advances through due times in due-time then FIFO registration order', () => {
  const clock = new FakeInvocationClock({ initialNowMs: 10 });
  const observed: string[] = [];

  clock.schedule(5, () => observed.push(`first:${clock.now()}`));
  clock.schedule(2, () => observed.push(`early:${clock.now()}`));
  clock.schedule(5, () => observed.push(`second:${clock.now()}`));

  clock.advanceBy(5);

  expect(observed).toEqual(['early:12', 'first:15', 'second:15']);
  expect(clock.now()).toBe(15);
});

test('drains zero-delay and in-target children while retaining later children', () => {
  const clock = new FakeInvocationClock({ initialNowMs: 0 });
  const observed: string[] = [];

  clock.schedule(3, () => {
    observed.push(`parent:${clock.now()}`);
    clock.schedule(0, () => observed.push(`zero-child:${clock.now()}`));
    clock.schedule(2, () => observed.push(`in-target-child:${clock.now()}`));
    clock.schedule(3, () => observed.push(`later-child:${clock.now()}`));
  });

  clock.advanceBy(5);

  expect(observed).toEqual(['parent:3', 'zero-child:3', 'in-target-child:5']);
  expect(clock.now()).toBe(5);
  expect(clock.pendingActionCount()).toBe(1);

  clock.fireNext();
  expect(observed).toEqual(['parent:3', 'zero-child:3', 'in-target-child:5', 'later-child:6']);
  expect(clock.now()).toBe(6);
});

test('advanceBy zero drains current-time descendants', () => {
  const clock = new FakeInvocationClock({ initialNowMs: 7 });
  const observed: string[] = [];

  clock.schedule(0, () => {
    observed.push('parent');
    clock.schedule(0, () => observed.push('child'));
  });

  clock.advanceBy(0);

  expect(observed).toEqual(['parent', 'child']);
  expect(clock.now()).toBe(7);
});

test('fireNext moves time and invokes one action without recursively draining children', () => {
  const clock = new FakeInvocationClock({ initialNowMs: 0 });
  const observed: string[] = [];

  clock.schedule(2, () => {
    observed.push('parent');
    clock.schedule(0, () => observed.push('child'));
  });

  clock.fireNext();
  expect(observed).toEqual(['parent']);
  expect(clock.now()).toBe(2);
  expect(clock.pendingActionCount()).toBe(1);

  clock.fireNext();
  expect(observed).toEqual(['parent', 'child']);
  expect(() => clock.fireNext()).toThrow('No scheduled action');
});

test('fireNext preserves fired state and resumes later work after a callback failure', () => {
  const clock = new FakeInvocationClock({ initialNowMs: 0 });
  const failure = new Error('fireNext callback failed');
  const observed: string[] = [];

  clock.schedule(3, () => {
    throw failure;
  });
  clock.schedule(5, () => observed.push(`later:${clock.now()}`));

  let thrown: unknown;
  try {
    clock.fireNext();
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBe(failure);
  expect(clock.now()).toBe(3);
  expect(clock.pendingActionCount()).toBe(1);

  clock.fireNext();
  expect(observed).toEqual(['later:5']);
  expect(clock.now()).toBe(5);
  expect(clock.pendingActionCount()).toBe(0);
});

test('cancellation is idempotent and prevents execution', () => {
  const clock = new FakeInvocationClock({ initialNowMs: 0 });
  let called = false;
  const cancel = clock.schedule(1, () => {
    called = true;
  });

  cancel();
  cancel();
  clock.advanceBy(1);

  expect(called).toBe(false);
  expect(clock.pendingActionCount()).toBe(0);
});

test('preserves fired state and time when callbacks throw, then resumes later work', () => {
  const clock = new FakeInvocationClock({ initialNowMs: 0 });
  const failure = new Error('callback failed');
  const observed: string[] = [];

  clock.schedule(1, () => {
    throw failure;
  });
  clock.schedule(1, () => observed.push(`later:${clock.now()}`));

  expect(() => clock.advanceBy(2)).toThrow(failure);
  expect(clock.now()).toBe(1);
  expect(clock.pendingActionCount()).toBe(1);

  clock.advanceBy(1);
  expect(observed).toEqual(['later:1']);
  expect(clock.now()).toBe(2);
});
