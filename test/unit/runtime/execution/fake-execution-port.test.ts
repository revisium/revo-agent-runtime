import { expect, test } from 'vitest';

import { InvocationInputSnapshot } from '../../../../src/runtime/execution/index.js';
import {
  FakeInvocationExecutionPort,
  type InvocationExecutionCall,
} from '../../../support/execution/fake-execution-port.js';

const testSnapshot = (): InvocationInputSnapshot => {
  const snapshot = InvocationInputSnapshot.create({ invocationId: 'test' });
  if (snapshot === undefined) throw new Error('Unable to create test snapshot');
  return snapshot;
};

test('starts queued executions in FIFO order and exposes frozen copied calls', async () => {
  const port = new FakeInvocationExecutionPort();
  const startFailure = new Error('first start failed');

  port.enqueueStart(startFailure);
  port.enqueueStart('running');
  port.enqueueStart('running');

  await expect(port.start(testSnapshot())).rejects.toBe(startFailure);
  const first = await port.start(testSnapshot());
  const second = await port.start(testSnapshot());

  expect(port.calls()).toEqual([{ type: 'start' }, { type: 'start' }, { type: 'start' }]);
  const calls = port.calls();
  expect(Object.isFrozen(calls)).toBe(true);
  expect(Object.isFrozen(calls[0])).toBe(true);
  expect(calls).toEqual([
    { type: 'start' },
    { type: 'start' },
    { type: 'start' },
  ] satisfies readonly InvocationExecutionCall[]);

  port.settleNaturalCompletion(1);
  port.settleNaturalCompletion(2);
  const firstObservation = await first.completion;
  expect(Object.isFrozen(firstObservation)).toBe(true);
  expect(firstObservation).toEqual({ status: 'completed' });
  await expect(second.completion).resolves.toEqual({ status: 'completed' });
  await expect(port.start(testSnapshot())).rejects.toThrow('No start result is queued');
});

test('keeps cancellation-request settlement independent from terminal completion', async () => {
  const port = new FakeInvocationExecutionPort();
  port.enqueueStart('running');
  const execution = await port.start(testSnapshot());

  const cancellation = execution.requestCancellation();
  expect(port.calls()).toEqual([
    { type: 'start' },
    { type: 'request-cancellation', executionId: 1 },
  ] satisfies readonly InvocationExecutionCall[]);

  port.settleCancellationRequest(1);
  await expect(cancellation).resolves.toBeUndefined();

  let completed = false;
  void execution.completion.then(() => {
    completed = true;
  });
  await Promise.resolve();
  expect(completed).toBe(false);

  port.settleNaturalCompletion(1);
  await expect(execution.completion).resolves.toEqual({ status: 'completed' });
});

test('retains rejection identity without completing execution', async () => {
  const port = new FakeInvocationExecutionPort();
  const rejection = new Error('cancellation request rejected');
  port.enqueueStart('running');
  const execution = await port.start(testSnapshot());

  const cancellation = execution.requestCancellation();
  port.rejectCancellationRequest(1, rejection);

  await expect(cancellation).rejects.toBe(rejection);
  let completed = false;
  void execution.completion.then(
    () => {
      completed = true;
    },
    () => {
      completed = true;
    },
  );
  await Promise.resolve();
  expect(completed).toBe(false);

  port.settleNaturalCompletion(1);
  await expect(execution.completion).resolves.toEqual({ status: 'completed' });
  expect(() => port.confirmCancellation(1)).toThrow('already settled');
});

test('settles a pending cancellation request before natural completion', async () => {
  const port = new FakeInvocationExecutionPort();
  port.enqueueStart('running');
  const execution = await port.start(testSnapshot());
  const cancellation = execution.requestCancellation();

  port.settleNaturalCompletion(1);

  await expect(cancellation).rejects.toThrow(
    'Execution completed before cancellation request was accepted',
  );
  await expect(execution.completion).resolves.toEqual({ status: 'completed' });
});

test('confirms accepted cancellation only through execution completion', async () => {
  const port = new FakeInvocationExecutionPort();
  port.enqueueStart('running');
  const execution = await port.start(testSnapshot());
  const cancellation = execution.requestCancellation();
  port.settleCancellationRequest(1);
  await expect(cancellation).resolves.toBeUndefined();

  port.confirmCancellation(1);

  const observation = await execution.completion;
  expect(Object.isFrozen(observation)).toBe(true);
  expect(observation).toEqual({ status: 'cancelled' });
  await expect(execution.requestCancellation()).rejects.toThrow('Execution already completed');
  expect(() => port.settleNaturalCompletion(1)).toThrow('already settled');
});

test('settles pending cancellation with completion failures and preserves accepted requests', async () => {
  const port = new FakeInvocationExecutionPort();
  const pendingFailure = new Error('execution failed before cancellation acceptance');
  const acceptedFailure = new Error('execution failed after cancellation acceptance');

  port.enqueueStart('running');
  const pending = await port.start(testSnapshot());
  const pendingRequest = pending.requestCancellation();
  port.settleCompletionFailure(1, pendingFailure);

  await expect(pendingRequest).rejects.toBe(pendingFailure);
  await expect(pending.completion).rejects.toBe(pendingFailure);

  port.enqueueStart('running');
  const accepted = await port.start(testSnapshot());
  const acceptedRequest = accepted.requestCancellation();
  port.settleCancellationRequest(2);
  await expect(acceptedRequest).resolves.toBeUndefined();
  port.settleCompletionFailure(2, acceptedFailure);

  await expect(accepted.completion).rejects.toBe(acceptedFailure);
  expect(() => port.confirmCancellation(2)).toThrow('already settled');
});

test('rejects duplicate and post-terminal controls without leaving request promises pending', async () => {
  const port = new FakeInvocationExecutionPort();
  port.enqueueStart('running');
  const execution = await port.start(testSnapshot());
  const cancellation = execution.requestCancellation();

  expect(() => execution.requestCancellation()).toThrow('already requested');
  expect(() => port.confirmCancellation(1)).toThrow('not accepted');
  expect(() => port.rejectCancellationRequest(2, new Error('unknown'))).toThrow(
    'Unknown execution id 2',
  );

  port.settleNaturalCompletion(1);
  await expect(cancellation).rejects.toThrow(
    'Execution completed before cancellation request was accepted',
  );
  await expect(execution.completion).resolves.toEqual({ status: 'completed' });
  expect(() => port.settleCancellationRequest(1)).toThrow('not pending');
  expect(() => port.rejectCancellationRequest(1, new Error('late request'))).toThrow('not pending');
  expect(() => port.confirmCancellation(1)).toThrow('already settled');
  expect(() => port.settleNaturalCompletion(1)).toThrow('already settled');
  expect(() => port.settleCompletionFailure(1, new Error('late completion'))).toThrow(
    'already settled',
  );
});
