import { expect, test } from 'vitest';

import { createInvocationLifecycleManager } from '../../../src/application/manager/index.js';
import type { InvocationExecutionPorts } from '../../../src/runtime/execution/index.js';
import { buildAgentDefinition } from '../../support/definition/build-agent-definition.js';
import { FakeInvocationClock } from '../../support/execution/fake-clock.js';
import { FakeInvocationExecutionPort } from '../../support/execution/fake-execution-port.js';
import { FakeOutputClaimPort } from '../../support/execution/fake-output-claim-port.js';
import { FakeInvocationOutputPort } from '../../support/execution/fake-output-port.js';
import { FreshAvailableExecutableProbePort } from '../../support/probe/fresh-available-executable-probe-port.js';

const definition = buildAgentDefinition();
const agent = Object.freeze({ id: definition.id, version: definition.version });
const lifecycleOptions = Object.freeze({ definitions: Object.freeze([definition]) });
type LifecycleManagerPortsInput = Omit<InvocationExecutionPorts, 'workspace' | 'outputClaim'> &
  Partial<Pick<InvocationExecutionPorts, 'workspace' | 'outputClaim'>>;

const createLifecycleManager = (ports: LifecycleManagerPortsInput) =>
  createInvocationLifecycleManager(lifecycleOptions, {
    ...ports,
    executableProbe: new FreshAvailableExecutableProbePort('/resolved/fixture-agent', '1.0.0'),
    outputClaim: ports.outputClaim ?? new FakeOutputClaimPort('created'),
    workspace: { admit: async () => ({ status: 'admitted', directory: '/workspace/project' }) },
  });

const resultSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
};

const createStartInput = (
  overrides: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> =>
  Object.freeze({
    agent,
    prompt: 'Return JSON.',
    workspace: Object.freeze({ directory: '/workspace/project' }),
    parameters: Object.freeze({}),
    permissions: Object.freeze({}),
    result: Object.freeze({ schema: resultSchema }),
    output: Object.freeze({ directory: '/outputs/invocation' }),
    ...overrides,
  });

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};
const expectAcceptedInvocation = (
  outcome: Awaited<ReturnType<ReturnType<typeof createInvocationLifecycleManager>['start']>>,
) => {
  if (outcome.status !== 'accepted') throw new Error('Expected accepted invocation');
  return outcome;
};

test('publishes a completed canonical result before synchronous terminal delivery and resolves active waiters afterward', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  output.enqueuePrepare();
  output.enqueueTerminalResultRecording();
  execution.enqueueStart('running');
  const manager = createLifecycleManager({
    execution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output,
  });
  const accepted = expectAcceptedInvocation(
    await manager.start(createStartInput({ invocationId: 'ordered' })),
  );
  let handleResolved = false;
  let waiterResolved = false;
  let eventDelivered = false;
  const handleResult = accepted.handle.result().then((result) => {
    handleResolved = true;
    return result;
  });
  const activeWaiter = manager.waitForResult('ordered').then((result) => {
    waiterResolved = true;
    return result;
  });
  manager.subscribe({}, (event) => {
    const lookup = manager.getResult(event.invocationId);
    expect(lookup.state).toBe('completed');
    if (lookup.state !== 'completed') throw new Error('Expected completed result lookup.');
    expect('result' in event).toBe(false);
    expect(handleResolved).toBe(false);
    expect(waiterResolved).toBe(false);
    eventDelivered = true;
  });

  await flush();
  execution.settleNaturalCompletion(1, new TextEncoder().encode('{"ok":true}'));
  await flush();

  const handleOutcome = await handleResult;
  const waiterOutcome = await activeWaiter;
  expect(eventDelivered).toBe(true);
  expect(waiterOutcome).toBe(handleOutcome);
  expect(await manager.waitForResult('ordered')).toBe(handleOutcome);
  expect(Object.isFrozen(handleOutcome)).toBe(true);
  if (handleOutcome.status === 'succeeded') expect(Object.isFrozen(handleOutcome.value)).toBe(true);
});

test('keeps an active waiter and handle result after later FIFO eviction while fresh access becomes unknown', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  output.enqueuePrepare();
  output.enqueuePrepare();
  output.enqueuePrepare();
  output.enqueueTerminalResultRecording();
  output.enqueueTerminalResultRecording();
  execution.enqueueStart('running');
  execution.enqueueStart('running');
  execution.enqueueStart('running');
  const manager = createInvocationLifecycleManager(
    { definitions: [definition], limits: { maxCompletedInvocations: 1 } },
    {
      execution,
      clock: new FakeInvocationClock({ initialNowMs: 0 }),
      output,
      outputClaim: new FakeOutputClaimPort('created'),
      executableProbe: new FreshAvailableExecutableProbePort('/resolved/fixture-agent', '1.0.0'),
      workspace: { admit: async () => ({ status: 'admitted', directory: '/workspace/project' }) },
    },
  );
  const first = expectAcceptedInvocation(
    await manager.start(createStartInput({ invocationId: 'first' })),
  );
  const activeWaiter = manager.waitForResult('first');

  await flush();
  execution.settleNaturalCompletion(1, new TextEncoder().encode('{"id":"first"}'));
  await flush();
  const second = expectAcceptedInvocation(
    await manager.start(createStartInput({ invocationId: 'second' })),
  );
  await flush();
  execution.settleNaturalCompletion(2, new TextEncoder().encode('{"id":"second"}'));
  await flush();

  const firstHandleResult = await first.handle.result();
  expect(await activeWaiter).toBe(firstHandleResult);
  expect(manager.getResult('first')).toEqual({ state: 'unknown' });
  await expect(manager.waitForResult('first')).resolves.toEqual({ state: 'unknown' });
  const secondLookup = manager.getResult('second');
  expect(secondLookup.state).toBe('completed');
  if (secondLookup.state !== 'completed') throw new Error('Expected retained second result.');
  await expect(second.handle.result()).resolves.toBe(secondLookup.result);
  expect((await manager.start(createStartInput({ invocationId: 'first' }))).status).toBe(
    'accepted',
  );
});

test('does not publish a pending terminal result before its output commit settles', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  output.enqueuePrepare();
  output.enqueuePendingTerminalResultRecording();
  execution.enqueueStart('running');
  const manager = createLifecycleManager({
    execution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output,
  });
  const accepted = expectAcceptedInvocation(
    await manager.start(createStartInput({ invocationId: 'pending-result' })),
  );
  let eventCalls = 0;
  let waiterSettled = false;
  manager.subscribe({}, () => {
    eventCalls += 1;
  });
  void manager.waitForResult('pending-result').then(() => {
    waiterSettled = true;
  });

  await flush();
  execution.settleNaturalCompletion(1, new TextEncoder().encode('{"ok":true}'));
  await flush();

  expect(accepted.lifecycle.currentState()).toBe('finalizing');
  expect(manager.getResult('pending-result')).toEqual({ state: 'active' });
  expect(eventCalls).toBe(0);
  expect(waiterSettled).toBe(false);
  output.fulfilPendingTerminalResultRecording(1);
  await flush();
  expect(manager.getResult('pending-result').state).toBe('completed');
  expect(eventCalls).toBe(1);
  expect(waiterSettled).toBe(true);
});

test('uses validated default capacity and rejects invalid capacity through lifecycle composition', async () => {
  const createPorts = () => ({
    execution: new FakeInvocationExecutionPort(),
    output: new FakeInvocationOutputPort(),
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    outputClaim: new FakeOutputClaimPort('created'),
    workspace: {
      admit: async () =>
        Object.freeze({ status: 'admitted' as const, directory: '/workspace/project' }),
    },
  });
  const invalidMinimum = createPorts();
  expect(() =>
    createInvocationLifecycleManager(
      { definitions: [definition], limits: { maxCompletedInvocations: 0 } },
      invalidMinimum,
    ),
  ).toThrow('Agent manager limit is invalid.');
  const invalidMaximum = createPorts();
  expect(() =>
    createInvocationLifecycleManager(
      { definitions: [definition], limits: { maxCompletedInvocations: 1_001 } },
      invalidMaximum,
    ),
  ).toThrow('Agent manager limit is invalid.');

  const { execution, output, clock } = createPorts();
  for (let index = 0; index <= 1_000; index += 1) {
    output.enqueuePrepare();
    output.enqueueTerminalResultRecording();
    execution.enqueueStart('running');
  }
  const manager = createLifecycleManager({ execution, output, clock });
  const complete = async (index: number): Promise<void> => {
    if (index > 1_000) return;
    const accepted = await manager.start(createStartInput({ invocationId: `default-${index}` }));
    expect(accepted.status).toBe('accepted');
    await flush();
    execution.settleNaturalCompletion(index + 1, new TextEncoder().encode('{}'));
    await flush();
    await complete(index + 1);
  };
  await complete(0);

  expect(manager.getResult('default-0')).toEqual({ state: 'unknown' });
  expect(manager.getResult('default-1').state).toBe('completed');
  expect(manager.getResult('default-1000').state).toBe('completed');
}, 30_000);

test('delivers one canonical terminal event for output failure, execution failure, caller cancellation, and deadline cancellation', async () => {
  const outputFailureExecution = new FakeInvocationExecutionPort();
  const outputFailureOutput = new FakeInvocationOutputPort();
  outputFailureExecution.enqueueStart('running');
  outputFailureOutput.enqueuePrepare();
  outputFailureOutput.enqueueTerminalResultRecording(new Error('write failed'));
  const outputFailureManager = createLifecycleManager({
    execution: outputFailureExecution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output: outputFailureOutput,
  });
  const outputFailureEvents: unknown[] = [];
  outputFailureManager.subscribe({}, (event) => outputFailureEvents.push(event.invocationId));
  const outputFailure = expectAcceptedInvocation(
    await outputFailureManager.start(createStartInput({ invocationId: 'output-failure-event' })),
  );
  await flush();
  outputFailureExecution.settleNaturalCompletion(1, new TextEncoder().encode('{}'));
  await flush();
  const outputFailureResult = await outputFailure.handle.result();
  expect(outputFailureEvents).toEqual(['output-failure-event']);
  expect(outputFailureResult).toEqual({ status: 'failed', reason: 'output_write_failed' });

  const executionFailureExecution = new FakeInvocationExecutionPort();
  const executionFailureOutput = new FakeInvocationOutputPort();
  executionFailureExecution.enqueueStart('running');
  executionFailureOutput.enqueuePrepare();
  executionFailureOutput.enqueueTerminalResultRecording();
  const executionFailureManager = createLifecycleManager({
    execution: executionFailureExecution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output: executionFailureOutput,
  });
  const executionFailureEvents: unknown[] = [];
  executionFailureManager.subscribe({}, (event) => executionFailureEvents.push(event.invocationId));
  const executionFailure = expectAcceptedInvocation(
    await executionFailureManager.start(
      createStartInput({ invocationId: 'execution-failure-event' }),
    ),
  );
  await flush();
  executionFailureExecution.settleCompletionFailure(1, new Error('execution failed'));
  await flush();
  const executionFailureResult = await executionFailure.handle.result();
  expect(executionFailureEvents).toEqual(['execution-failure-event']);
  expect(executionFailureResult).toEqual({ status: 'failed', reason: 'execution_failed' });

  const cancellationExecution = new FakeInvocationExecutionPort();
  const cancellationOutput = new FakeInvocationOutputPort();
  cancellationExecution.enqueueStart('running');
  cancellationOutput.enqueuePrepare();
  cancellationOutput.enqueueTerminalResultRecording();
  const cancellationManager = createLifecycleManager({
    execution: cancellationExecution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output: cancellationOutput,
  });
  const cancellationEvents: unknown[] = [];
  cancellationManager.subscribe({}, (event) => cancellationEvents.push(event.invocationId));
  const cancellation = expectAcceptedInvocation(
    await cancellationManager.start(createStartInput({ invocationId: 'caller-cancel-event' })),
  );
  await flush();
  const cancellationRequest = cancellation.lifecycle.requestCancellation();
  await flush();
  cancellationExecution.settleCancellationRequest(1);
  await cancellationRequest;
  cancellationExecution.confirmCancellation(1);
  await flush();
  const cancellationResult = await cancellation.handle.result();
  expect(cancellationEvents).toEqual(['caller-cancel-event']);
  expect(cancellationResult).toEqual({ status: 'cancelled' });

  const deadlineExecution = new FakeInvocationExecutionPort();
  const deadlineOutput = new FakeInvocationOutputPort();
  const deadlineClock = new FakeInvocationClock({ initialNowMs: 0 });
  deadlineExecution.enqueueStart('running');
  deadlineOutput.enqueuePrepare();
  deadlineOutput.enqueueTerminalResultRecording();
  const deadlineManager = createLifecycleManager({
    execution: deadlineExecution,
    clock: deadlineClock,
    output: deadlineOutput,
  });
  const deadlineEvents: unknown[] = [];
  deadlineManager.subscribe({}, (event) => deadlineEvents.push(event.invocationId));
  const deadline = expectAcceptedInvocation(
    await deadlineManager.start(
      createStartInput({
        invocationId: 'deadline-cancel-event',
        limits: { wallClockTimeoutMs: 1_000, idleTimeoutMs: 1_000 },
      }),
    ),
  );
  await flush();
  deadlineClock.advanceBy(1_000);
  await flush();
  deadlineExecution.settleCancellationRequest(1);
  deadlineExecution.confirmCancellation(1);
  await flush();
  const deadlineResult = await deadline.handle.result();
  expect(deadlineEvents).toEqual(['deadline-cancel-event']);
  expect(deadlineResult).toEqual({ status: 'timed_out' });
});

test('isolates a throwing listener without stranding manager handle or active waiter resolution', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  output.enqueuePrepare();
  output.enqueuePrepare();
  output.enqueueTerminalResultRecording();
  output.enqueueTerminalResultRecording();
  execution.enqueueStart('running');
  execution.enqueueStart('running');
  const manager = createLifecycleManager({
    execution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output,
  });
  let throwingCalls = 0;
  let handleResolved = false;
  let waiterResolved = false;
  const independentResults: unknown[] = [];
  const throwingAdmission = manager.subscribe({}, () => {
    throwingCalls += 1;
    throw new Error('listener failure');
  });
  const independentAdmission = manager.subscribe({}, (event) => {
    const lookup = manager.getResult(event.invocationId);
    expect(lookup.state).toBe('completed');
    if (lookup.state !== 'completed') throw new Error('Expected completed result lookup.');
    expect('result' in event).toBe(false);
    if (event.invocationId === 'first') {
      expect(handleResolved).toBe(false);
      expect(waiterResolved).toBe(false);
    }
    independentResults.push(lookup.result);
  });
  expect(throwingAdmission.state).toBe('subscribed');
  expect(independentAdmission.state).toBe('subscribed');

  const first = expectAcceptedInvocation(
    await manager.start(createStartInput({ invocationId: 'first' })),
  );
  const handleResult = first.handle.result().then((result) => {
    handleResolved = true;
    return result;
  });
  const activeWaiter = manager.waitForResult('first').then((result) => {
    waiterResolved = true;
    return result;
  });
  await flush();
  execution.settleNaturalCompletion(1, new TextEncoder().encode('{"id":"first"}'));
  await flush();

  const firstResult = await handleResult;
  expect(await activeWaiter).toBe(firstResult);
  expect(independentResults).toEqual([firstResult]);
  expect(throwingCalls).toBe(1);

  const second = expectAcceptedInvocation(
    await manager.start(createStartInput({ invocationId: 'second' })),
  );
  await flush();
  execution.settleNaturalCompletion(2, new TextEncoder().encode('{"id":"second"}'));
  await flush();

  const secondResult = await second.handle.result();
  expect(independentResults).toEqual([firstResult, secondResult]);
  expect(throwingCalls).toBe(1);
});

test('admits subscriptions independently from completed result retention', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  output.enqueuePrepare();
  output.enqueueTerminalResultRecording();
  execution.enqueueStart('running');
  const manager = createInvocationLifecycleManager(
    { definitions: [definition], limits: { maxCompletedInvocations: 1 } },
    {
      execution,
      clock: new FakeInvocationClock({ initialNowMs: 0 }),
      output,
      outputClaim: new FakeOutputClaimPort('created'),
      executableProbe: new FreshAvailableExecutableProbePort('/resolved/fixture-agent', '1.0.0'),
      workspace: { admit: async () => ({ status: 'admitted', directory: '/workspace/project' }) },
    },
  );
  const received: unknown[] = [];
  const acceptedListener = manager.subscribe({}, (event) => received.push(event.invocationId));
  const refusedCalls: unknown[] = [];
  const rejectedListener = manager.subscribe({}, (event) => refusedCalls.push(event.invocationId));
  expect(acceptedListener.state).toBe('subscribed');
  expect(rejectedListener.state).toBe('subscribed');

  const accepted = expectAcceptedInvocation(
    await manager.start(createStartInput({ invocationId: 'subscription-capacity' })),
  );
  await flush();
  execution.settleNaturalCompletion(1, new TextEncoder().encode('{"ok":true}'));
  await flush();

  const result = await accepted.handle.result();
  expect(received).toEqual(['subscription-capacity']);
  expect(refusedCalls).toEqual(['subscription-capacity']);
  expect(await manager.waitForResult('subscription-capacity')).toBe(result);
});
