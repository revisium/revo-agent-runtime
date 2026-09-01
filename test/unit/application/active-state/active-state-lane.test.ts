import { afterEach, expect, test, vi } from 'vitest';

import { ActiveStateLane } from '../../../../src/application/active-state/lane.js';
import type { ActiveInvocationStateSink } from '../../../../src/contracts/manager.js';
import { activeStateStory } from '../../../support/stories/active-state.js';
import { recoverySnapshot } from '../../../support/stories/recovery.js';

afterEach(() => vi.useRealTimers());

test.each(['throw', 'reject'] as const)(
  'contains a synchronous or rejected %s sink failure',
  async (failure) => {
    const sink: ActiveInvocationStateSink = {
      remove: async () => undefined,
      save: () => {
        if (failure === 'throw') throw new Error('private sink detail');
        return Promise.reject(new Error('private sink detail'));
      },
    };
    const lane = new ActiveStateLane(sink, 100);

    await expect(lane.save(recoverySnapshot('contained-failure'))).resolves.toBe('failed');
    await expect(lane.settled()).resolves.toBeUndefined();
  },
);

test('aborts an overdue mutation and reports unknown while its settlement is unresolved', async () => {
  vi.useFakeTimers();
  const state = activeStateStory();
  const held = state.holdNext('save');
  const lane = new ActiveStateLane(state.sink, 100);

  const saving = lane.save(recoverySnapshot('unknown-save'));
  await state.waitUntilRecorded(1);
  await vi.advanceTimersByTimeAsync(100);
  expect(state.signals()[0]!.aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(100);
  await expect(saving).resolves.toBe('unknown');

  const quiescence = lane.quiesce();
  await vi.advanceTimersByTimeAsync(100);
  await expect(quiescence).resolves.toBe('unknown');
  held.succeed();
  await expect(lane.settled()).resolves.toBeUndefined();
});

test('distinguishes a late applied mutation from an unknown mutation', async () => {
  vi.useFakeTimers();
  const state = activeStateStory();
  const held = state.holdNext('save');
  const lane = new ActiveStateLane(state.sink, 100);

  const saving = lane.save(recoverySnapshot('late-save'));
  await state.waitUntilRecorded(1);
  await vi.advanceTimersByTimeAsync(100);
  held.succeed();

  await expect(saving).resolves.toBe('late_applied');
  await expect(lane.quiesce()).resolves.toBe('confirmed');
});

test('contains a late rejected mutation after aborting its package-owned signal', async () => {
  vi.useFakeTimers();
  const state = activeStateStory();
  const held = state.holdNext('save');
  const lane = new ActiveStateLane(state.sink, 100);

  const saving = lane.save(recoverySnapshot('late-rejection'));
  await state.waitUntilRecorded(1);
  await vi.advanceTimersByTimeAsync(100);
  held.fail();

  await expect(saving).resolves.toBe('late_failed');
  await expect(lane.settled()).resolves.toBeUndefined();
});

test('serializes remove behind an unsettled save on the same invocation lane', async () => {
  const state = activeStateStory();
  const held = state.holdNext('save');
  const lane = new ActiveStateLane(state.sink, 10_000);

  const saving = lane.save(recoverySnapshot('serialized-lane'));
  const removing = lane.remove('serialized-lane');
  await state.waitUntilRecorded(1);
  expect(state.operations()).toEqual(['save:running']);

  held.succeed();
  await saving;
  await removing;
  expect(state.operations()).toEqual(['save:running', 'remove:serialized-lane']);
});
