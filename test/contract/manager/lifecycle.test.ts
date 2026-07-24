import { expect, test } from 'vitest';

import { createInvocationLifecycleManager } from '../../../src/application/manager/index.js';
import { FakeInvocationClock } from '../../support/execution/fake-clock.js';
import { FakeInvocationExecutionPort } from '../../support/execution/fake-execution-port.js';
import { FakeInvocationOutputPort } from '../../support/execution/fake-output-port.js';

const resultSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
};

test('rejects an invalid request before output preparation or execution start', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  output.enqueueTerminalResultRecording();
  const manager = createInvocationLifecycleManager({
    execution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output,
  });

  await expect(manager.start({ resultSchema, invocationId: '' })).resolves.toEqual({
    status: 'rejected',
    reason: 'invalid_request',
  });
  expect(output.calls()).toEqual([]);
  expect(execution.calls()).toEqual([]);
});

test('admits one concurrent duplicate after preparation and passes an immutable snapshot to execution', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  output.enqueueTerminalResultRecording();
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
    manager.start({ resultSchema, invocationId: 'same', metadata }),
    manager.start({ resultSchema, invocationId: 'same', metadata }),
  ]);

  expect([first.status, second.status].toSorted()).toEqual(['accepted', 'rejected']);
  expect(execution.calls()).toEqual([{ type: 'start' }]);
  metadata.nested.state = 'mutated';
  expect(execution.startedSnapshots()[0]?.metadata).toEqual({ nested: { state: 'accepted' } });
});

test('does not admit output preparation failures', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  output.enqueueTerminalResultRecording();
  output.enqueuePrepare(new Error('unavailable'));
  const manager = createInvocationLifecycleManager({
    execution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output,
  });

  await expect(manager.start({ resultSchema, invocationId: 'prepare-failure' })).resolves.toEqual({
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
  output.enqueueTerminalResultRecording();
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

  const first = await manager.start({ resultSchema, invocationId: 'reused' });
  if (first.status !== 'accepted') throw new Error('Expected first admission');
  await flush();
  execution.settleNaturalCompletion(1, new TextEncoder().encode('{}'));
  await flush();
  const second = await manager.start({ resultSchema, invocationId: 'reused' });

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
  output.enqueueTerminalResultRecording();
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

  const lifecycle = expectAccepted(
    await manager.start({ resultSchema, invocationId: 'failed-reuse' }),
  );
  await flush();
  execution.settleCompletionFailure(1, new Error('failed'));
  await flush();
  expect(lifecycle.terminalSettlement()).toEqual({ status: 'failed', reason: 'execution_failed' });
  expect((await manager.start({ resultSchema, invocationId: 'failed-reuse' })).status).toBe(
    'accepted',
  );
});

test('releases caller-cancelled composition admission only after confirmed cancellation', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  output.enqueueTerminalResultRecording();
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

  const lifecycle = expectAccepted(
    await manager.start({ resultSchema, invocationId: 'cancelled-reuse' }),
  );
  await flush();
  const cancellation = lifecycle.requestCancellation();
  await flush();
  execution.settleCancellationRequest(1);
  await cancellation;
  await expect(manager.start({ resultSchema, invocationId: 'cancelled-reuse' })).resolves.toEqual({
    status: 'rejected',
    reason: 'duplicate_invocation',
  });
  execution.confirmCancellation(1);
  await flush();
  expect(lifecycle.terminalSettlement()).toEqual({ status: 'cancelled' });
  expect((await manager.start({ resultSchema, invocationId: 'cancelled-reuse' })).status).toBe(
    'accepted',
  );
});

test('releases deadline-cancelled composition admission after confirmed cancellation', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  output.enqueueTerminalResultRecording();
  const clock = new FakeInvocationClock({ initialNowMs: 0 });
  execution.enqueueStart('running');
  execution.enqueueStart('running');
  output.enqueuePrepare();
  output.enqueuePrepare();
  output.enqueuePrepare();
  const manager = createInvocationLifecycleManager({ execution, clock, output });

  const lifecycle = expectAccepted(
    await manager.start({ resultSchema, invocationId: 'timeout-reuse', wallClockTimeoutMs: 1_000 }),
  );
  await flush();
  clock.advanceBy(1_000);
  await flush();
  await expect(manager.start({ resultSchema, invocationId: 'timeout-reuse' })).resolves.toEqual({
    status: 'rejected',
    reason: 'duplicate_invocation',
  });
  execution.settleCancellationRequest(1);
  execution.confirmCancellation(1);
  await flush();
  expect(lifecycle.terminalSettlement()).toEqual({ status: 'timed_out' });
  expect((await manager.start({ resultSchema, invocationId: 'timeout-reuse' })).status).toBe(
    'accepted',
  );
});

test('keeps a racing natural completion as the only terminal composition settlement', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  output.enqueueTerminalResultRecording();
  execution.enqueueStart('running');
  execution.enqueueStart('running');
  output.enqueuePrepare();
  output.enqueuePrepare();
  const manager = createInvocationLifecycleManager({
    execution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output,
  });

  const lifecycle = expectAccepted(
    await manager.start({ resultSchema, invocationId: 'race-reuse' }),
  );
  await flush();
  const cancellation = lifecycle.requestCancellation();
  await flush();
  execution.settleNaturalCompletion(1, new TextEncoder().encode('{}'));
  await expect(cancellation).rejects.toThrow(
    'Execution completed before cancellation request was accepted',
  );
  await flush();
  expect(lifecycle.terminalSettlement()).toEqual({ status: 'succeeded', value: {} });
  expect((await manager.start({ resultSchema, invocationId: 'race-reuse' })).status).toBe(
    'accepted',
  );
});

test('keeps an id active until its one pending terminal-result commit settles', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  const clock = new FakeInvocationClock({ initialNowMs: 0 });
  execution.enqueueStart('running');
  execution.enqueueStart('running');
  output.enqueuePrepare();
  output.enqueuePrepare();
  output.enqueuePrepare();
  output.enqueuePendingTerminalResultRecording();
  const manager = createInvocationLifecycleManager({ execution, clock, output });

  const first = expectAccepted(await manager.start({ resultSchema, invocationId: 'finalizing' }));
  await flush();
  execution.settleNaturalCompletion(1, new TextEncoder().encode('{"ok":true}'));
  await flush();

  expect(first.currentState()).toBe('finalizing');
  await expect(manager.start({ resultSchema, invocationId: 'finalizing' })).resolves.toEqual({
    status: 'rejected',
    reason: 'duplicate_invocation',
  });
  expect(output.calls().filter((call) => call.type === 'record-terminal-result')).toHaveLength(1);

  output.fulfilPendingTerminalResultRecording(1);
  await flush();
  expect(first.terminalSettlement()).toEqual({ status: 'succeeded', value: { ok: true } });
  expect((await manager.start({ resultSchema, invocationId: 'finalizing' })).status).toBe(
    'accepted',
  );
});

test('releases the id after one output commit failure without retrying the commit', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  execution.enqueueStart('running');
  execution.enqueueStart('running');
  output.enqueuePrepare();
  output.enqueuePrepare();
  output.enqueuePrepare();
  output.enqueueTerminalResultRecording(new Error('write failed'));
  const manager = createInvocationLifecycleManager({
    execution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output,
  });

  const lifecycle = expectAccepted(
    await manager.start({ resultSchema, invocationId: 'output-failure' }),
  );
  await flush();
  execution.settleNaturalCompletion(1, new TextEncoder().encode('{"ok":true}'));
  await flush();

  expect(lifecycle.terminalSettlement()).toEqual({
    status: 'failed',
    reason: 'output_write_failed',
  });
  expect(output.calls().filter((call) => call.type === 'record-terminal-result')).toHaveLength(1);
  expect((await manager.start({ resultSchema, invocationId: 'output-failure' })).status).toBe(
    'accepted',
  );
});

test('rejects an out-of-profile result schema before output preparation or execution start', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  const manager = createInvocationLifecycleManager({
    execution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output,
  });

  await expect(
    manager.start({
      invocationId: 'invalid-schema',
      resultSchema: { $schema: 'https://json-schema.org/draft/2020-12/schema', format: 'email' },
    }),
  ).resolves.toEqual({ status: 'rejected', reason: 'invalid_result_schema' });
  expect(output.calls()).toEqual([]);
  expect(execution.calls()).toEqual([]);
});

test('finalizes a deep in-bound response with one output commit before releasing its id', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  const clock = new FakeInvocationClock({ initialNowMs: 0 });
  const depth = 20_000;
  const response = new TextEncoder().encode(`${'{"next":'.repeat(depth)}{}${'}'.repeat(depth)}`);
  execution.enqueueStart('running');
  execution.enqueueStart('running');
  output.enqueuePrepare();
  output.enqueuePrepare();
  output.enqueuePrepare();
  output.enqueuePendingTerminalResultRecording();
  const manager = createInvocationLifecycleManager({ execution, clock, output });

  const lifecycle = expectAccepted(
    await manager.start({ resultSchema, invocationId: 'deep-result' }),
  );
  await flush();
  execution.settleNaturalCompletion(1, response);
  await flush();

  expect(response.byteLength).toBeLessThan(1_048_576);
  expect(lifecycle.currentState()).toBe('finalizing');
  expect(output.calls().filter((call) => call.type === 'record-terminal-result')).toHaveLength(1);
  await expect(manager.start({ resultSchema, invocationId: 'deep-result' })).resolves.toEqual({
    status: 'rejected',
    reason: 'duplicate_invocation',
  });

  output.fulfilPendingTerminalResultRecording(1);
  await flush();
  expect(lifecycle.currentState()).toBe('terminal');
  expect(lifecycle.terminalSettlement()?.status).toBe('succeeded');
  expect((await manager.start({ resultSchema, invocationId: 'deep-result' })).status).toBe(
    'accepted',
  );
});
