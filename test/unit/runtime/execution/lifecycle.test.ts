import { expect, test } from 'vitest';

import {
  InvocationInputSnapshot,
  InvocationLifecycle,
} from '../../../../src/runtime/execution/index.js';
import { FakeInvocationClock } from '../../../support/execution/fake-clock.js';
import { FakeInvocationExecutionPort } from '../../../support/execution/fake-execution-port.js';
import { FakeInvocationOutputPort } from '../../../support/execution/fake-output-port.js';

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const snapshot = (): InvocationInputSnapshot => {
  const value = InvocationInputSnapshot.create({
    invocationId: 'lifecycle',
    wallClockTimeoutMs: 1_000,
  });
  if (value === undefined) throw new Error('Unable to create test snapshot');
  return value;
};

const startLifecycle = (
  execution: FakeInvocationExecutionPort,
  clock = new FakeInvocationClock({ initialNowMs: 0 }),
) => {
  const settlements: Array<{ readonly status: string }> = [];
  const lifecycle = new InvocationLifecycle(
    { execution, clock, output: new FakeInvocationOutputPort() },
    snapshot(),
    (settlement) => settlements.push(settlement),
  );
  lifecycle.begin();
  return { lifecycle, settlements, clock };
};

test('queues cancellation during a deferred start and cancels exactly once after it runs', async () => {
  const execution = new FakeInvocationExecutionPort();
  execution.enqueuePendingStart();
  const { lifecycle, settlements } = startLifecycle(execution);
  const first = lifecycle.requestCancellation();
  const second = lifecycle.requestCancellation();

  expect(lifecycle.currentState()).toBe('cancelling');
  expect(first).toBe(second);
  execution.fulfilPendingStart(1);
  await flush();
  expect(execution.calls()).toEqual([
    { type: 'start' },
    { type: 'request-cancellation', executionId: 1 },
  ]);
  execution.settleCancellationRequest(1);
  await expect(first).resolves.toBeUndefined();
  execution.confirmCancellation(1);
  await flush();
  expect(settlements).toEqual([{ status: 'cancelled' }]);
});

test('settles a deferred start rejection once after queued cancellation', async () => {
  const execution = new FakeInvocationExecutionPort();
  execution.enqueuePendingStart();
  const { lifecycle, settlements } = startLifecycle(execution);
  const cancellation = lifecycle.requestCancellation();
  execution.rejectPendingStart(1, new Error('start failed'));
  await expect(cancellation).rejects.toThrow('start failed');
  await flush();
  expect(settlements).toEqual([{ status: 'failed' }]);
});

test('uses confirmed cancellation rather than a deadline fire as the terminal outcome', async () => {
  const execution = new FakeInvocationExecutionPort();
  execution.enqueueStart('running');
  const { lifecycle, settlements, clock } = startLifecycle(execution);
  await flush();
  clock.advanceBy(1_000);
  await flush();
  expect(settlements).toEqual([]);
  execution.settleCancellationRequest(1);
  execution.confirmCancellation(1);
  await flush();
  expect(lifecycle.terminalSettlement()).toEqual({ status: 'timed_out' });
  expect(settlements).toEqual([{ status: 'timed_out' }]);
});

test('lets same-turn natural completion win over a rejected pending cancellation request', async () => {
  const execution = new FakeInvocationExecutionPort();
  execution.enqueueStart('running');
  const { lifecycle, settlements } = startLifecycle(execution);
  await flush();
  const cancellation = lifecycle.requestCancellation();
  await flush();
  execution.settleNaturalCompletion(1);
  await expect(cancellation).rejects.toThrow(
    'Execution completed before cancellation request was accepted',
  );
  await flush();
  expect(settlements).toEqual([{ status: 'completed' }]);
  expect(lifecycle.terminalSettlement()).toEqual({ status: 'completed' });
});

test('moves accepted through starting and running before natural completion', async () => {
  const execution = new FakeInvocationExecutionPort();
  execution.enqueueStart('running');
  const { lifecycle, settlements, clock } = startLifecycle(execution);

  expect(lifecycle.currentState()).toBe('starting');
  await flush();
  expect(lifecycle.currentState()).toBe('running');
  expect(clock.pendingActionCount()).toBe(1);
  execution.settleNaturalCompletion(1);
  await flush();
  expect(settlements).toEqual([{ status: 'completed' }]);
  expect(lifecycle.currentState()).toBe('terminal');
  expect(clock.pendingActionCount()).toBe(0);
});

test('commits failed once when execution completion rejects', async () => {
  const execution = new FakeInvocationExecutionPort();
  execution.enqueueStart('running');
  const { lifecycle, settlements } = startLifecycle(execution);
  await flush();
  execution.settleCompletionFailure(1, new Error('completion failed'));
  await flush();

  expect(lifecycle.terminalSettlement()).toEqual({ status: 'failed' });
  expect(settlements).toEqual([{ status: 'failed' }]);
});

test('keeps fulfilled caller cancellation nonterminal until execution confirms it', async () => {
  const execution = new FakeInvocationExecutionPort();
  execution.enqueueStart('running');
  const { lifecycle, settlements } = startLifecycle(execution);
  await flush();
  const cancellation = lifecycle.requestCancellation();
  await flush();
  execution.settleCancellationRequest(1);
  await expect(cancellation).resolves.toBeUndefined();
  expect(settlements).toEqual([]);
  expect(lifecycle.currentState()).toBe('cancelling');
  execution.confirmCancellation(1);
  await flush();
  expect(settlements).toEqual([{ status: 'cancelled' }]);
});

test('preserves the first terminal settlement when late controls arrive', async () => {
  const execution = new FakeInvocationExecutionPort();
  execution.enqueueStart('running');
  const { lifecycle, settlements, clock } = startLifecycle(execution);
  await flush();
  execution.settleNaturalCompletion(1);
  await flush();
  clock.advanceBy(1_000);
  await flush();

  expect(() => execution.settleNaturalCompletion(1)).toThrow('already settled');
  expect(settlements).toEqual([{ status: 'completed' }]);
  expect(lifecycle.terminalSettlement()).toEqual({ status: 'completed' });
});

test('lets completion failure win while caller cancellation is pending', async () => {
  const execution = new FakeInvocationExecutionPort();
  execution.enqueueStart('running');
  const { lifecycle, settlements } = startLifecycle(execution);
  await flush();
  const cancellation = lifecycle.requestCancellation();
  await flush();
  execution.settleCompletionFailure(1, new Error('completion failure'));
  await expect(cancellation).rejects.toThrow('completion failure');
  await flush();

  expect(settlements).toEqual([{ status: 'failed' }]);
  expect(lifecycle.terminalSettlement()).toEqual({ status: 'failed' });
});

test('settles a standalone rejected cancellation request as failed after microtask arbitration', async () => {
  const execution = new FakeInvocationExecutionPort();
  execution.enqueueStart('running');
  const { lifecycle, settlements } = startLifecycle(execution);
  await flush();
  const cancellation = lifecycle.requestCancellation();
  await flush();
  execution.rejectCancellationRequest(1, new Error('cancellation rejected'));
  await expect(cancellation).rejects.toThrow('cancellation rejected');
  await flush();

  expect(settlements).toEqual([{ status: 'failed' }]);
  expect(lifecycle.terminalSettlement()).toEqual({ status: 'failed' });
});
