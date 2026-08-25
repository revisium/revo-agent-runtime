import { expect, test } from 'vitest';

import { createInvocationLifecycleManager } from '../../../src/application/manager/index.js';
import type { InvocationExecutionPorts } from '../../../src/runtime/execution/index.js';
import {
  buildAgentDefinition,
  createTestActiveStateSink,
} from '../../support/definition/build-agent-definition.js';
import { FakeInvocationClock } from '../../support/execution/fake-clock.js';
import { FakeInvocationExecutionPort } from '../../support/execution/fake-execution-port.js';
import { FakeOutputClaimPort } from '../../support/execution/fake-output-claim-port.js';
import { FakeInvocationOutputPort } from '../../support/execution/fake-output-port.js';
import { FakeOutputPreparationPort } from '../../support/execution/fake-output-preparation-port.js';
import { FreshAvailableExecutableProbePort } from '../../support/probe/fresh-available-executable-probe-port.js';

const cancellationCompletion = (
  outcome:
    | Readonly<{ status: 'committed'; completion: Promise<void> }>
    | Readonly<{ status: 'too_late' }>,
): Promise<void> => {
  expect(outcome.status).toBe('committed');
  if (outcome.status !== 'committed') throw new Error('Expected committed cancellation.');
  return outcome.completion;
};

const definition = buildAgentDefinition();
const agent = Object.freeze({ id: definition.id, version: definition.version });
const lifecycleOptions = Object.freeze({
  activeStateSink: createTestActiveStateSink(),
  definitions: Object.freeze([definition]),
});
type LifecycleManagerPortsInput = Omit<
  InvocationExecutionPorts,
  'workspace' | 'outputClaim' | 'outputPreparation'
> &
  Partial<Pick<InvocationExecutionPorts, 'workspace' | 'outputClaim' | 'outputPreparation'>>;

const createLifecycleManager = async (ports: LifecycleManagerPortsInput) => {
  const manager = createInvocationLifecycleManager(lifecycleOptions, () => ({
    ...ports,
    executableProbe: new FreshAvailableExecutableProbePort('/resolved/fixture-agent', '1.0.0'),
    outputClaim: ports.outputClaim ?? new FakeOutputClaimPort('created'),
    outputPreparation: ports.outputPreparation ?? new FakeOutputPreparationPort('prepared'),
    workspace: { admit: async () => ({ status: 'admitted', directory: '/workspace/project' }) },
  }));
  await manager.initialize([]);
  return manager;
};

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
  await new Promise<void>((resolve) => setImmediate(resolve));
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
  output.enqueueTerminalResultRecording();
  execution.enqueueStart('running');
  const manager = await createLifecycleManager({
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
  const secondWaiterOutcome = await manager.waitForResult('ordered');
  expect(eventDelivered).toBe(true);
  expect(waiterOutcome).toBe(handleOutcome);
  expect(secondWaiterOutcome).toBe(handleOutcome);
  const lookup = manager.getResult('ordered');
  expect(lookup.state).toBe('completed');
  if (lookup.state !== 'completed') throw new Error('Expected completed result lookup.');
  expect(lookup.result).toBe(handleOutcome);
  await expect(manager.cancel('ordered')).resolves.toEqual({
    state: 'already_completed',
    result: handleOutcome,
  });
  expect(Object.isFrozen(handleOutcome)).toBe(true);
  expect(handleOutcome.files.directory).toBe('/outputs/invocation');
  expect(handleOutcome.files.result).toBe('result.json');
  expect(handleOutcome.schemaVersion).toBe('agent-invocation-result/v1');
  expect(handleOutcome.invocationId).toBe('ordered');
  expect(handleOutcome.exit).toEqual({ code: 0, signal: null });
  expect(handleOutcome.durationMs).toBeGreaterThanOrEqual(0);
  const published = output.recordedTerminalResults();
  expect(published).toHaveLength(1);
  expect(published[0]).toBe(handleOutcome);
  if (handleOutcome.status === 'succeeded') expect(Object.isFrozen(handleOutcome.value)).toBe(true);
});

test('rejecting terminal publication still commits one failed result with exit evidence', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  output.enqueuePendingTerminalResultRecording();
  execution.enqueueStart('running');
  const manager = await createLifecycleManager({
    execution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output,
  });
  const events: string[] = [];
  manager.subscribe({}, (event) => events.push(event.invocationId));
  const accepted = expectAcceptedInvocation(
    await manager.start(createStartInput({ invocationId: 'terminal-rejection' })),
  );
  await flush();
  execution.settleNaturalCompletion(1, new TextEncoder().encode('{"ok":true}'));
  await flush();
  output.rejectPendingTerminalResultRecording(1, new Error('terminal publication rejected'));
  const result = await accepted.handle.result();

  expect(result).toMatchObject({
    status: 'failed',
    error: { code: 'revo.agent.output_write_failed' },
    exit: { code: 0, signal: null },
  });
  if (result.status !== 'failed') throw new Error('Expected failed result.');
  expect(result.error.code).not.toBe('revo.agent.internal');
  expect(result.files.result).toBeUndefined();
  expect(events).toEqual(['terminal-rejection']);
  expect(output.recordedTerminalResults()).toHaveLength(0);
  expect(output.calls().filter((call) => call.type === 'publish-terminal-result')).toHaveLength(1);
});

test('keeps an active waiter and handle result after later FIFO eviction while fresh access becomes unknown', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  output.enqueueTerminalResultRecording();
  output.enqueueTerminalResultRecording();
  execution.enqueueStart('running');
  execution.enqueueStart('running');
  execution.enqueueStart('running');
  const manager = createInvocationLifecycleManager(
    {
      activeStateSink: createTestActiveStateSink(),
      definitions: [definition],
      limits: { maxCompletedInvocations: 1 },
    },
    () => ({
      execution,
      clock: new FakeInvocationClock({ initialNowMs: 0 }),
      output,
      outputClaim: new FakeOutputClaimPort('created'),
      outputPreparation: new FakeOutputPreparationPort('prepared'),
      executableProbe: new FreshAvailableExecutableProbePort('/resolved/fixture-agent', '1.0.0'),
      workspace: { admit: async () => ({ status: 'admitted', directory: '/workspace/project' }) },
    }),
  );
  await manager.initialize([]);
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
  await expect(manager.waitForResult('first')).rejects.toMatchObject({
    fault: { code: 'revo.agent.invocation_unknown' },
  });
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
  output.enqueuePendingTerminalResultRecording();
  execution.enqueueStart('running');
  const manager = await createLifecycleManager({
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
  expect(manager.getResult('pending-result')).toMatchObject({
    state: 'running',
    invocation: { status: 'running' },
  });
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
    executableProbe: new FreshAvailableExecutableProbePort('/resolved/fixture-agent', '1.0.0'),
    output: new FakeInvocationOutputPort(),
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    outputClaim: new FakeOutputClaimPort('created'),
    outputPreparation: new FakeOutputPreparationPort('prepared'),
    workspace: {
      admit: async () =>
        Object.freeze({ status: 'admitted' as const, directory: '/workspace/project' }),
    },
  });
  const invalidMinimum = createPorts();
  expect(() =>
    createInvocationLifecycleManager(
      {
        activeStateSink: createTestActiveStateSink(),
        definitions: [definition],
        limits: { maxCompletedInvocations: 0 },
      },
      () => invalidMinimum,
    ),
  ).toThrow('Agent manager limit is invalid.');
  const invalidMaximum = createPorts();
  expect(() =>
    createInvocationLifecycleManager(
      {
        activeStateSink: createTestActiveStateSink(),
        definitions: [definition],
        limits: { maxCompletedInvocations: 1_001 },
      },
      () => invalidMaximum,
    ),
  ).toThrow('Agent manager limit is invalid.');

  const { execution, output, clock } = createPorts();
  for (let index = 0; index <= 1_000; index += 1) {
    output.enqueueTerminalResultRecording();
    execution.enqueueStart('running');
  }
  const manager = await createLifecycleManager({ execution, output, clock });
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
  outputFailureOutput.enqueueTerminalResultRecording(new Error('write failed'));
  const outputFailureManager = await createLifecycleManager({
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
  expect(outputFailureResult).toMatchObject({ status: 'failed' });

  const executionFailureExecution = new FakeInvocationExecutionPort();
  const executionFailureOutput = new FakeInvocationOutputPort();
  executionFailureExecution.enqueueStart('running');
  executionFailureOutput.enqueueTerminalResultRecording();
  const executionFailureManager = await createLifecycleManager({
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
  expect(executionFailureResult).toMatchObject({ status: 'failed' });

  const cancellationExecution = new FakeInvocationExecutionPort();
  const cancellationOutput = new FakeInvocationOutputPort();
  cancellationExecution.enqueueStart('running');
  cancellationOutput.enqueueTerminalResultRecording();
  const cancellationManager = await createLifecycleManager({
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
  await cancellationCompletion(cancellationRequest);
  cancellationExecution.confirmCancellation(1);
  await flush();
  const cancellationResult = await cancellation.handle.result();
  expect(cancellationEvents).toEqual(['caller-cancel-event']);
  expect(cancellationResult).toMatchObject({ status: 'cancelled' });

  const deadlineExecution = new FakeInvocationExecutionPort();
  const deadlineOutput = new FakeInvocationOutputPort();
  const deadlineClock = new FakeInvocationClock({ initialNowMs: 0 });
  deadlineExecution.enqueueStart('running');
  deadlineOutput.enqueueTerminalResultRecording();
  const deadlineManager = await createLifecycleManager({
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
  expect(deadlineResult).toMatchObject({ status: 'timed_out' });
});

test('isolates a throwing listener without stranding manager handle or active waiter resolution', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  output.enqueueTerminalResultRecording();
  output.enqueueTerminalResultRecording();
  execution.enqueueStart('running');
  execution.enqueueStart('running');
  const manager = await createLifecycleManager({
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
  expect(throwingCalls).toBe(2);
});

test('admits subscriptions independently from completed result retention', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  output.enqueueTerminalResultRecording();
  execution.enqueueStart('running');
  const manager = createInvocationLifecycleManager(
    {
      activeStateSink: createTestActiveStateSink(),
      definitions: [definition],
      limits: { maxCompletedInvocations: 1 },
    },
    () => ({
      execution,
      clock: new FakeInvocationClock({ initialNowMs: 0 }),
      output,
      outputClaim: new FakeOutputClaimPort('created'),
      outputPreparation: new FakeOutputPreparationPort('prepared'),
      executableProbe: new FreshAvailableExecutableProbePort('/resolved/fixture-agent', '1.0.0'),
      workspace: { admit: async () => ({ status: 'admitted', directory: '/workspace/project' }) },
    }),
  );
  await manager.initialize([]);
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

test('cancel reports requested, already_completed, and unknown states', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  output.enqueueTerminalResultRecording();
  execution.enqueueStart('running');
  const manager = await createLifecycleManager({
    execution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output,
  });

  const accepted = expectAcceptedInvocation(
    await manager.start(createStartInput({ invocationId: 'cancel-happy-paths' })),
  );
  await flush();
  await expect(manager.cancel('cancel-happy-paths')).resolves.toEqual({ state: 'requested' });
  await flush();
  execution.settleCancellationRequest(1);
  execution.confirmCancellation(1);
  await flush();
  const completed = await accepted.handle.result();

  await expect(manager.cancel('cancel-happy-paths')).resolves.toEqual({
    state: 'already_completed',
    result: completed,
  });
  await expect(manager.cancel('missing-cancel-target')).resolves.toEqual({ state: 'unknown' });
});

test('cancel memoizes an in-flight cancellation request dispatch', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  output.enqueueTerminalResultRecording();
  execution.enqueueStart('running');
  const manager = await createLifecycleManager({
    execution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output,
  });

  expectAcceptedInvocation(
    await manager.start(createStartInput({ invocationId: 'cancel-memoized' })),
  );
  await flush();
  await expect(manager.cancel('cancel-memoized')).resolves.toEqual({ state: 'requested' });
  await expect(manager.cancel('cancel-memoized')).resolves.toEqual({ state: 'requested' });
  await flush();

  expect(execution.calls()).toEqual([
    { type: 'start' },
    { type: 'request-cancellation', executionId: 1 },
  ]);
});

test('cancel during finalization waits for and reports the real completed result', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  output.enqueuePendingTerminalResultRecording();
  execution.enqueueStart('running');
  const manager = await createLifecycleManager({
    execution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output,
  });
  const accepted = expectAcceptedInvocation(
    await manager.start(createStartInput({ invocationId: 'cancel-finalizing' })),
  );
  await flush();
  execution.settleNaturalCompletion(1, new TextEncoder().encode('{"ok":true}'));
  await flush();
  expect(accepted.lifecycle.currentState()).toBe('finalizing');
  expect(manager.getResult('cancel-finalizing')).toMatchObject({
    state: 'running',
    invocation: { status: 'running' },
  });
  let cancelSettled = false;
  const cancellation = manager.cancel('cancel-finalizing').then((outcome) => {
    cancelSettled = true;
    return outcome;
  });
  await flush();
  expect(cancelSettled).toBe(false);

  output.fulfilPendingTerminalResultRecording(1);
  await flush();
  const result = await accepted.handle.result();
  await expect(cancellation).resolves.toEqual({ state: 'already_completed', result });
});

test('cancel requested does not force cancelled when natural completion wins', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  output.enqueueTerminalResultRecording();
  execution.enqueueStart('running');
  const manager = await createLifecycleManager({
    execution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output,
  });

  expectAcceptedInvocation(
    await manager.start(createStartInput({ invocationId: 'cancel-natural-wins' })),
  );
  await flush();
  await expect(manager.cancel('cancel-natural-wins')).resolves.toEqual({ state: 'requested' });
  await flush();
  execution.settleNaturalCompletion(1, new TextEncoder().encode('{"winner":"natural"}'));
  await flush();

  const lookup = manager.getResult('cancel-natural-wins');
  expect(lookup.state).toBe('completed');
  if (lookup.state !== 'completed') throw new Error('Expected completed lookup.');
  expect(lookup.result).toMatchObject({
    status: 'succeeded',
    value: { winner: 'natural' },
  });
});

test('cancel during pending admission returns unknown', async () => {
  let admitWorkspace:
    | ((value: { readonly status: 'admitted'; readonly directory: string }) => void)
    | undefined;
  const workspaceAdmission = new Promise<{
    readonly status: 'admitted';
    readonly directory: string;
  }>((resolve) => {
    admitWorkspace = resolve;
  });
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  output.enqueueTerminalResultRecording();
  execution.enqueueStart('running');
  const manager = await createLifecycleManager({
    execution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output,
    workspace: { admit: async () => workspaceAdmission },
  });

  const start = manager.start(createStartInput({ invocationId: 'cancel-pending' }));
  await Promise.resolve();
  await expect(manager.cancel('cancel-pending')).resolves.toEqual({ state: 'unknown' });
  if (admitWorkspace === undefined) throw new Error('Expected workspace admission resolver.');
  admitWorkspace({ status: 'admitted', directory: '/workspace/project' });
  const accepted = expectAcceptedInvocation(await start);
  await flush();
  execution.settleNaturalCompletion(1, new TextEncoder().encode('{}'));
  await flush();
  await expect(accepted.handle.result()).resolves.toMatchObject({ status: 'succeeded' });
});
