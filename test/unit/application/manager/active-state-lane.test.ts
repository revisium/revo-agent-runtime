import { afterEach, expect, test, vi } from 'vitest';

import { ActiveStateLane } from '../../../../src/application/manager/active-state-lane.js';
import type {
  ActiveInvocationSnapshot,
  ActiveInvocationStateSink,
} from '../../../../src/runtime/spec/index.js';

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

const deferred = (): Deferred => {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  if (resolve === undefined) throw new Error('Unable to create deferred.');
  return Object.freeze({ promise, resolve });
};

const snapshot: ActiveInvocationSnapshot = Object.freeze({
  invocationId: 'active-state-lane',
  pin: Object.freeze({
    agentId: 'fixture-agent',
    agentVersion: '1.0.0',
    definitionDigest: 'sha256:definition',
  }),
  state: 'running',
  process: Object.freeze({
    pid: 123,
    processGroupId: 123,
    fingerprint: 'sha256:process',
    startedAt: '2026-08-24T10:00:00.000Z',
  }),
});

afterEach(() => {
  vi.useRealTimers();
});

test('never dispatches remove after a rejected save', async () => {
  const remove = vi.fn(async (): Promise<void> => undefined);
  const sink: ActiveInvocationStateSink = Object.freeze({
    save: async (): Promise<void> => {
      throw new Error('save rejected');
    },
    remove,
  });
  const lane = new ActiveStateLane(sink, 100);

  await expect(lane.save(snapshot, Date.now() + 100)).resolves.toEqual({
    status: 'rejected',
  });
  await expect(lane.remove(snapshot.invocationId, Date.now() + 100)).resolves.toBe(false);
  expect(remove).not.toHaveBeenCalled();
});

test('serializes remove after the preceding save fulfils', async () => {
  const save = deferred();
  const calls: string[] = [];
  const lane = new ActiveStateLane(
    Object.freeze({
      save: async (): Promise<void> => {
        calls.push('save');
        await save.promise;
      },
      remove: async (): Promise<void> => {
        calls.push('remove');
      },
    }),
    100,
  );

  const saving = lane.save(snapshot, Date.now() + 1_000);
  const removing = lane.remove(snapshot.invocationId, Date.now() + 1_000);
  await Promise.resolve();
  expect(calls).toEqual(['save']);

  save.resolve();
  await expect(saving).resolves.toEqual({ status: 'fulfilled' });
  await expect(removing).resolves.toBe(true);
  expect(calls).toEqual(['save', 'remove']);
});

test('waits one extra operation timeout for a timed-out save before compensating remove', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000);
  const save = deferred();
  const remove = vi.fn(async (): Promise<void> => undefined);
  const lane = new ActiveStateLane(Object.freeze({ save: () => save.promise, remove }), 100);

  const saving = lane.save(snapshot, 1_100);
  await vi.advanceTimersByTimeAsync(100);
  await expect(saving).resolves.toEqual({ status: 'timed_out' });

  const removing = lane.remove(snapshot.invocationId, 1_300);
  await vi.advanceTimersByTimeAsync(50);
  expect(remove).not.toHaveBeenCalled();
  save.resolve();
  await vi.advanceTimersByTimeAsync(0);

  await expect(removing).resolves.toBe(true);
  expect(remove).toHaveBeenCalledTimes(1);
});

test('does not retry remove after its first rejection', async () => {
  const remove = vi.fn(async (): Promise<void> => {
    throw new Error('remove rejected');
  });
  const lane = new ActiveStateLane(
    Object.freeze({ save: async (): Promise<void> => undefined, remove }),
    100,
  );

  await expect(lane.save(snapshot, Date.now() + 100)).resolves.toEqual({
    status: 'fulfilled',
  });
  await expect(lane.remove(snapshot.invocationId, Date.now() + 100)).resolves.toBe(false);
  await expect(lane.remove(snapshot.invocationId, Date.now() + 100)).resolves.toBe(false);
  expect(remove).toHaveBeenCalledTimes(1);
});

test('still removes the running row when a later cancelling save rejects', async () => {
  let saveNumber = 0;
  const remove = vi.fn(async (): Promise<void> => undefined);
  const lane = new ActiveStateLane(
    Object.freeze({
      save: async (): Promise<void> => {
        saveNumber += 1;
        if (saveNumber === 2) throw new Error('cancelling save rejected');
      },
      remove,
    }),
    100,
  );

  await expect(lane.save(snapshot, Date.now() + 100)).resolves.toEqual({
    status: 'fulfilled',
  });
  await expect(
    lane.save(Object.freeze({ ...snapshot, state: 'cancelling' }), Date.now() + 100),
  ).resolves.toEqual({ status: 'rejected' });
  await expect(lane.remove(snapshot.invocationId, Date.now() + 100)).resolves.toBe(true);
  expect(remove).toHaveBeenCalledTimes(1);
});
