import { expect, test } from 'vitest';

import { ProbeAdmission } from '../../../../src/application/manager/probe-admission.js';

interface Activity {
  active: number;
  maximum: number;
}

interface DeferredOperation<T> {
  readonly run: () => Promise<T>;
  readonly reject: (reason: unknown) => void;
  readonly resolve: () => void;
}

const flushAdmissionMicrotasks = async (): Promise<void> => {
  const flush = (remaining: number): Promise<void> =>
    remaining === 0 ? Promise.resolve() : Promise.resolve().then(() => flush(remaining - 1));

  await flush(8);
};

const trackedDeferredOperation = <T>(
  value: T,
  starts: T[],
  activity: Activity,
): DeferredOperation<T> => {
  let rejectPending: (reason: unknown) => void = () => undefined;
  let resolvePending: () => void = () => undefined;
  const pending = new Promise<void>((resolve, reject) => {
    resolvePending = resolve;
    rejectPending = reject;
  });

  return {
    run: async (): Promise<T> => {
      starts.push(value);
      activity.active += 1;
      activity.maximum = Math.max(activity.maximum, activity.active);
      try {
        await pending;
        return value;
      } finally {
        activity.active -= 1;
      }
    },
    reject: rejectPending,
    resolve: resolvePending,
  };
};

const resolve = (operations: readonly DeferredOperation<unknown>[]): void => {
  for (const operation of operations) operation.resolve();
};

test('shares its cap across singles and batches without bypassing queued singles', async () => {
  const admission = new ProbeAdmission();
  const activity = { active: 0, maximum: 0 };
  const singleStarts: number[] = [];
  const batchStarts: number[] = [];
  const singles = Array.from({ length: 16 }, (_, index) =>
    trackedDeferredOperation(index, singleStarts, activity),
  );
  const batch = Array.from({ length: 17 }, (_, index) =>
    trackedDeferredOperation(index, batchStarts, activity),
  );

  const singlePromises = singles.map(({ run }) => admission.runSingle(run));
  const batchPromise = admission.runBatch(batch.map(({ run }) => run));
  await flushAdmissionMicrotasks();

  expect(singleStarts).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  expect(batchStarts).toEqual([]);
  expect(activity.maximum).toBe(8);

  resolve(singles.slice(0, 8));
  await flushAdmissionMicrotasks();
  expect(singleStarts).toEqual(Array.from({ length: 16 }, (_, index) => index));
  expect(batchStarts).toEqual([]);

  resolve(singles.slice(8));
  await Promise.all(singlePromises);
  await flushAdmissionMicrotasks();
  expect(batchStarts).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);

  resolve(batch.slice(0, 8));
  await flushAdmissionMicrotasks();
  expect(batchStarts).toEqual(Array.from({ length: 16 }, (_, index) => index));

  resolve(batch.slice(8, 16));
  await flushAdmissionMicrotasks();
  expect(batchStarts).toEqual(Array.from({ length: 17 }, (_, index) => index));
  batch[16]?.resolve();

  await expect(batchPromise).resolves.toEqual(Array.from({ length: 17 }, (_, index) => index));
  expect(activity.maximum).toBe(8);
});

test('yields to an earlier single before the second wave without leaving capacity idle', async () => {
  const admission = new ProbeAdmission();
  const activity = { active: 0, maximum: 0 };
  const starts: Array<number | 'single'> = [];
  const batch = Array.from({ length: 17 }, (_, index) =>
    trackedDeferredOperation<number | 'single'>(index, starts, activity),
  );
  const single = trackedDeferredOperation<number | 'single'>('single', starts, activity);

  const batchPromise = admission.runBatch(batch.map(({ run }) => run));
  await flushAdmissionMicrotasks();
  const singlePromise = admission.runSingle(single.run);
  resolve(batch.slice(0, 8));
  await flushAdmissionMicrotasks();

  expect(starts).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 'single', 8, 9, 10, 11, 12, 13, 14]);
  expect(activity.active).toBe(8);

  single.resolve();
  await singlePromise;
  await flushAdmissionMicrotasks();
  expect(starts).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 'single', 8, 9, 10, 11, 12, 13, 14, 15]);

  resolve(batch.slice(8, 16));
  await flushAdmissionMicrotasks();
  batch[16]?.resolve();
  await expect(batchPromise).resolves.toEqual(Array.from({ length: 17 }, (_, index) => index));
  expect(activity.maximum).toBe(8);
});

test('keeps queued singles in offer order ahead of a later batch wave', async () => {
  const admission = new ProbeAdmission();
  const activity = { active: 0, maximum: 0 };
  const starts: Array<number | string> = [];
  const batch = Array.from({ length: 16 }, (_, index) =>
    trackedDeferredOperation<number | string>(index, starts, activity),
  );
  const singles = ['s0', 's1', 's2'].map((value) =>
    trackedDeferredOperation<number | string>(value, starts, activity),
  );

  const batchPromise = admission.runBatch(batch.map(({ run }) => run));
  await flushAdmissionMicrotasks();
  const singlePromises = singles.map(({ run }) => admission.runSingle(run));
  resolve(batch.slice(0, 8));
  await flushAdmissionMicrotasks();

  expect(starts).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 's0', 's1', 's2', 8, 9, 10, 11, 12]);

  resolve(singles);
  await Promise.all(singlePromises);
  await flushAdmissionMicrotasks();
  resolve(batch.slice(8));
  await expect(batchPromise).resolves.toEqual(Array.from({ length: 16 }, (_, index) => index));
});

test('does not let a later single bypass already offered second-wave work', async () => {
  const admission = new ProbeAdmission();
  const activity = { active: 0, maximum: 0 };
  const starts: Array<number | string> = [];
  const batch = Array.from({ length: 16 }, (_, index) =>
    trackedDeferredOperation<number | string>(index, starts, activity),
  );
  const early = trackedDeferredOperation<number | string>('early', starts, activity);
  const late = trackedDeferredOperation<number | string>('late', starts, activity);

  const batchPromise = admission.runBatch(batch.map(({ run }) => run));
  await flushAdmissionMicrotasks();
  const earlyPromise = admission.runSingle(early.run);
  resolve(batch.slice(0, 8));
  await flushAdmissionMicrotasks();
  const latePromise = admission.runSingle(late.run);

  early.resolve();
  await earlyPromise;
  await flushAdmissionMicrotasks();
  expect(starts).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 'early', 8, 9, 10, 11, 12, 13, 14, 15]);

  batch[8]?.resolve();
  await flushAdmissionMicrotasks();
  expect(starts.at(-1)).toBe('late');
  late.resolve();
  resolve(batch.slice(9));
  await latePromise;
  await expect(batchPromise).resolves.toEqual(Array.from({ length: 16 }, (_, index) => index));
});

test('waits for every failing-wave settlement and rejects by wave input order', async () => {
  const admission = new ProbeAdmission();
  const activity = { active: 0, maximum: 0 };
  const starts: number[] = [];
  const operations = Array.from({ length: 16 }, (_, index) =>
    trackedDeferredOperation(index, starts, activity),
  );
  const lowerIndexReason = new Error('lower index');
  const higherIndexReason = new Error('higher index');
  const batchPromise = admission.runBatch(operations.map(({ run }) => run));
  let batchSettled = false;
  const observedBatch = batchPromise.then(
    () => {
      batchSettled = true;
    },
    () => {
      batchSettled = true;
    },
  );
  await flushAdmissionMicrotasks();

  operations[7]?.reject(higherIndexReason);
  resolve(operations.slice(0, 5));
  await flushAdmissionMicrotasks();
  expect(starts).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  expect(batchSettled).toBe(false);

  operations[6]?.reject(lowerIndexReason);
  await flushAdmissionMicrotasks();
  expect(batchSettled).toBe(false);

  operations[5]?.resolve();
  await expect(batchPromise).rejects.toBe(lowerIndexReason);
  await observedBatch;
  expect(activity.active).toBe(0);
  expect(starts).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
});

test('releases capacity after rejection and synchronous throws', async () => {
  const admission = new ProbeAdmission();
  const activity = { active: 0, maximum: 0 };
  const starts: string[] = [];
  const rejected = trackedDeferredOperation('rejected', starts, activity);
  const retained = Array.from({ length: 6 }, (_, index) =>
    trackedDeferredOperation(`retained-${index}`, starts, activity),
  );
  const afterFailures = ['after-first', 'after-second'].map((value) =>
    trackedDeferredOperation(value, starts, activity),
  );

  const rejectedPromise = admission.runSingle(rejected.run);
  const thrownPromise = admission.runSingle(() => {
    starts.push('thrown');
    throw new Error('synchronous failure');
  });
  const thrownFailure = expect(thrownPromise).rejects.toThrow('synchronous failure');
  const retainedPromises = retained.map(({ run }) => admission.runSingle(run));
  const afterFailurePromises = afterFailures.map(({ run }) => admission.runSingle(run));
  await flushAdmissionMicrotasks();
  expect(starts).toEqual([
    'rejected',
    'thrown',
    'retained-0',
    'retained-1',
    'retained-2',
    'retained-3',
    'retained-4',
    'retained-5',
    'after-first',
  ]);

  rejected.reject(new Error('deferred failure'));
  await expect(rejectedPromise).rejects.toThrow('deferred failure');
  await thrownFailure;
  await flushAdmissionMicrotasks();
  expect(starts).toEqual([
    'rejected',
    'thrown',
    'retained-0',
    'retained-1',
    'retained-2',
    'retained-3',
    'retained-4',
    'retained-5',
    'after-first',
    'after-second',
  ]);

  resolve(afterFailures);
  resolve(retained);
  await Promise.all([...afterFailurePromises, ...retainedPromises]);
  expect(activity.active).toBe(0);
});

test('returns frozen batch values in input order and freezes an empty batch', async () => {
  const admission = new ProbeAdmission();
  const activity = { active: 0, maximum: 0 };
  const starts: number[] = [];
  const operations = Array.from({ length: 9 }, (_, index) =>
    trackedDeferredOperation(index, starts, activity),
  );
  const batchPromise = admission.runBatch(operations.map(({ run }) => run));
  await flushAdmissionMicrotasks();

  for (const operation of operations.slice(0, 8).toReversed()) operation.resolve();
  await flushAdmissionMicrotasks();
  operations[8]?.resolve();

  const result = await batchPromise;
  expect(result).toEqual(Array.from({ length: 9 }, (_, index) => index));
  expect(Object.isFrozen(result)).toBe(true);

  const empty = await admission.runBatch([]);
  expect(empty).toEqual([]);
  expect(Object.isFrozen(empty)).toBe(true);
  expect(starts).toEqual(Array.from({ length: 9 }, (_, index) => index));
});

test('does not coalesce repeated closures', async () => {
  const admission = new ProbeAdmission();
  const activity = { active: 0, maximum: 0 };
  const starts: string[] = [];
  const operation = trackedDeferredOperation('same', starts, activity);

  const batchPromise = admission.runBatch([operation.run, operation.run]);
  await flushAdmissionMicrotasks();
  expect(starts).toEqual(['same', 'same']);

  operation.resolve();
  await expect(batchPromise).resolves.toEqual(['same', 'same']);
});
