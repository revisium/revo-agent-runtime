import { expect, test } from 'vitest';

import { createInvocationLifecycleManager } from '../../../src/application/manager/index.js';
import { FakeInvocationClock } from '../../support/execution/fake-clock.js';
import { FakeInvocationExecutionPort } from '../../support/execution/fake-execution-port.js';
import { FakeInvocationOutputPort } from '../../support/execution/fake-output-port.js';

test('rejects an invalid request before output preparation or execution start', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  const manager = createInvocationLifecycleManager({
    execution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output,
  });

  await expect(manager.start({ invocationId: '' })).resolves.toEqual({
    status: 'rejected',
    reason: 'invalid_request',
  });
  expect(output.calls()).toEqual([]);
  expect(execution.calls()).toEqual([]);
});

test('admits one concurrent duplicate after preparation and passes an immutable snapshot to execution', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  const metadata = { nested: { state: 'accepted' } };
  execution.enqueueStart('running');
  output.enqueuePrepare();
  output.enqueuePrepare();
  const manager = createInvocationLifecycleManager({
    execution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output,
  });

  const [first, second] = await Promise.all([
    manager.start({ invocationId: 'same', metadata }),
    manager.start({ invocationId: 'same', metadata }),
  ]);

  expect([first.status, second.status].toSorted()).toEqual(['accepted', 'rejected']);
  expect(execution.calls()).toEqual([{ type: 'start' }]);
  metadata.nested.state = 'mutated';
  expect(execution.startedSnapshots()[0]?.metadata).toEqual({ nested: { state: 'accepted' } });
});

test('does not admit output preparation failures', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  output.enqueuePrepare(new Error('unavailable'));
  const manager = createInvocationLifecycleManager({
    execution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output,
  });

  await expect(manager.start({ invocationId: 'prepare-failure' })).resolves.toEqual({
    status: 'rejected',
    reason: 'output_prepare_failed',
  });
  expect(execution.calls()).toEqual([]);
});

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

test('releases an id after terminal settlement so it can be admitted again', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  execution.enqueueStart('running');
  execution.enqueueStart('running');
  output.enqueuePrepare();
  output.enqueuePrepare();
  output.enqueuePrepare();
  const manager = createInvocationLifecycleManager({
    execution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output,
  });

  const first = await manager.start({ invocationId: 'reused' });
  if (first.status !== 'accepted') throw new Error('Expected first admission');
  await flush();
  execution.settleNaturalCompletion(1);
  await flush();
  const second = await manager.start({ invocationId: 'reused' });

  expect(second.status).toBe('accepted');
  expect(execution.calls()).toEqual([{ type: 'start' }, { type: 'start' }]);
});

const expectAccepted = (
  outcome: Awaited<ReturnType<ReturnType<typeof createInvocationLifecycleManager>['start']>>,
) => {
  if (outcome.status !== 'accepted') throw new Error('Expected accepted invocation');
  return outcome.lifecycle;
};

test('releases failed composition admission after completion rejection', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  execution.enqueueStart('running');
  execution.enqueueStart('running');
  output.enqueuePrepare();
  output.enqueuePrepare();
  output.enqueuePrepare();
  const manager = createInvocationLifecycleManager({
    execution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output,
  });

  const lifecycle = expectAccepted(await manager.start({ invocationId: 'failed-reuse' }));
  await flush();
  execution.settleCompletionFailure(1, new Error('failed'));
  await flush();
  expect(lifecycle.terminalSettlement()).toEqual({ status: 'failed' });
  expect((await manager.start({ invocationId: 'failed-reuse' })).status).toBe('accepted');
});

test('releases caller-cancelled composition admission only after confirmed cancellation', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  execution.enqueueStart('running');
  execution.enqueueStart('running');
  output.enqueuePrepare();
  output.enqueuePrepare();
  output.enqueuePrepare();
  const manager = createInvocationLifecycleManager({
    execution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output,
  });

  const lifecycle = expectAccepted(await manager.start({ invocationId: 'cancelled-reuse' }));
  await flush();
  const cancellation = lifecycle.requestCancellation();
  await flush();
  execution.settleCancellationRequest(1);
  await cancellation;
  await expect(manager.start({ invocationId: 'cancelled-reuse' })).resolves.toEqual({
    status: 'rejected',
    reason: 'duplicate_invocation',
  });
  execution.confirmCancellation(1);
  await flush();
  expect(lifecycle.terminalSettlement()).toEqual({ status: 'cancelled' });
  expect((await manager.start({ invocationId: 'cancelled-reuse' })).status).toBe('accepted');
});

test('releases deadline-cancelled composition admission after confirmed cancellation', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  const clock = new FakeInvocationClock({ initialNowMs: 0 });
  execution.enqueueStart('running');
  execution.enqueueStart('running');
  output.enqueuePrepare();
  output.enqueuePrepare();
  output.enqueuePrepare();
  const manager = createInvocationLifecycleManager({ execution, clock, output });

  const lifecycle = expectAccepted(
    await manager.start({ invocationId: 'timeout-reuse', wallClockTimeoutMs: 1_000 }),
  );
  await flush();
  clock.advanceBy(1_000);
  await flush();
  await expect(manager.start({ invocationId: 'timeout-reuse' })).resolves.toEqual({
    status: 'rejected',
    reason: 'duplicate_invocation',
  });
  execution.settleCancellationRequest(1);
  execution.confirmCancellation(1);
  await flush();
  expect(lifecycle.terminalSettlement()).toEqual({ status: 'timed_out' });
  expect((await manager.start({ invocationId: 'timeout-reuse' })).status).toBe('accepted');
});

test('keeps a racing natural completion as the only terminal composition settlement', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  execution.enqueueStart('running');
  execution.enqueueStart('running');
  output.enqueuePrepare();
  output.enqueuePrepare();
  const manager = createInvocationLifecycleManager({
    execution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output,
  });

  const lifecycle = expectAccepted(await manager.start({ invocationId: 'race-reuse' }));
  await flush();
  const cancellation = lifecycle.requestCancellation();
  await flush();
  execution.settleNaturalCompletion(1);
  await expect(cancellation).rejects.toThrow(
    'Execution completed before cancellation request was accepted',
  );
  await flush();
  expect(lifecycle.terminalSettlement()).toEqual({ status: 'completed' });
  expect((await manager.start({ invocationId: 'race-reuse' })).status).toBe('accepted');
});
