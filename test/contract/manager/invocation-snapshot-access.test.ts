import { expect, test, vi } from 'vitest';

import { createInvocationLifecycleManager } from '../../../src/application/manager/index.js';
import type { InvocationExecutionPorts } from '../../../src/runtime/execution/index.js';
import type { AgentInvocationStatus } from '../../../src/runtime/spec/index.js';
import { buildAgentDefinition } from '../../support/definition/build-agent-definition.js';
import { FakeInvocationClock } from '../../support/execution/fake-clock.js';
import { FakeInvocationExecutionPort } from '../../support/execution/fake-execution-port.js';
import { FakeOutputClaimPort } from '../../support/execution/fake-output-claim-port.js';
import { FakeInvocationOutputPort } from '../../support/execution/fake-output-port.js';
import { FakeOutputPreparationPort } from '../../support/execution/fake-output-preparation-port.js';
import { FreshAvailableExecutableProbePort } from '../../support/probe/fresh-available-executable-probe-port.js';

const definition = buildAgentDefinition();
const agent = Object.freeze({ id: definition.id, version: definition.version });
const otherDefinition = buildAgentDefinition({ id: 'other.agent', version: '2.0.0' });
const otherAgent = Object.freeze({ id: otherDefinition.id, version: otherDefinition.version });
const lifecycleOptions = Object.freeze({
  definitions: Object.freeze([definition, otherDefinition]),
});

type LifecycleManagerPortsInput = Omit<
  InvocationExecutionPorts,
  'workspace' | 'outputClaim' | 'outputPreparation'
> &
  Partial<Pick<InvocationExecutionPorts, 'workspace' | 'outputClaim' | 'outputPreparation'>>;

const createLifecycleManager = (ports: LifecycleManagerPortsInput) =>
  createInvocationLifecycleManager(lifecycleOptions, {
    ...ports,
    executableProbe: new FreshAvailableExecutableProbePort('/resolved/fixture-agent', '1.0.0'),
    outputClaim: ports.outputClaim ?? new FakeOutputClaimPort('created'),
    outputPreparation: ports.outputPreparation ?? new FakeOutputPreparationPort('prepared'),
    workspace: { admit: async () => ({ status: 'admitted', directory: '/workspace/project' }) },
  });

const resultSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
};

const createStartInput = (
  overrides: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> => {
  const invocationId =
    typeof overrides.invocationId === 'string' ? overrides.invocationId : 'invocation';
  return Object.freeze({
    agent,
    prompt: 'Return JSON.',
    workspace: Object.freeze({ directory: '/workspace/project' }),
    parameters: Object.freeze({}),
    permissions: Object.freeze({}),
    result: Object.freeze({ schema: resultSchema }),
    output: Object.freeze({
      directory: `/outputs/${invocationId}`,
    }),
    ...overrides,
  });
};

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

const expectSnapshot = (
  manager: ReturnType<typeof createInvocationLifecycleManager>,
  invocationId: string,
  status: AgentInvocationStatus,
  expectedAgent = agent,
) => {
  const snapshot = manager.getInvocation(invocationId);
  expect(snapshot).toMatchObject({ invocationId, status });
  if (snapshot === undefined) throw new Error(`Expected snapshot for ${invocationId}`);
  expect(snapshot.pin.agentId).toBe(expectedAgent.id);
  expect(snapshot.pin.agentVersion).toBe(expectedAgent.version);
  expect(typeof snapshot.pin.definitionDigest).toBe('string');
  expect(snapshot.outputDirectory).toBe(`/outputs/${invocationId}`);
  return snapshot;
};

test('projects active and terminal invocation snapshots with canonical timestamps and metadata', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-08-24T00:00:00.000Z'));
  try {
    const execution = new FakeInvocationExecutionPort();
    const output = new FakeInvocationOutputPort();
    output.enqueueTerminalResultRecording();
    execution.enqueuePendingStart();
    const manager = createLifecycleManager({
      execution,
      clock: new FakeInvocationClock({ initialNowMs: 0 }),
      output,
    });

    const accepted = expectAcceptedInvocation(
      await manager.start(
        createStartInput({
          invocationId: 'snap',
          metadata: Object.freeze({ ticket: 'T-1' }),
        }),
      ),
    );
    const starting = expectSnapshot(manager, 'snap', 'starting');
    expect(starting.acceptedAt).toBe('2026-08-24T00:00:00.000Z');
    expect(starting.startedAt).toBeUndefined();
    expect(starting.finishedAt).toBeUndefined();
    expect(starting.metadata).toEqual({ ticket: 'T-1' });
    expect(manager.listInvocations()).toEqual([starting]);

    vi.setSystemTime(new Date('2026-08-24T00:00:01.000Z'));
    execution.fulfilPendingStart(1);
    await flush();
    const running = expectSnapshot(manager, 'snap', 'running');
    expect(running.startedAt).toBe('2026-08-24T00:00:01.000Z');

    vi.setSystemTime(new Date('2026-08-24T00:00:02.000Z'));
    execution.settleNaturalCompletion(1, new TextEncoder().encode('{"ok":true}'));
    await flush();
    const completed = expectSnapshot(manager, 'snap', 'succeeded');
    expect(completed.acceptedAt).toBe(starting.acceptedAt);
    expect(completed.startedAt).toBe(running.startedAt);
    expect(completed.finishedAt).toBe('2026-08-24T00:00:02.000Z');
    expect(completed.metadata).toEqual({ ticket: 'T-1' });
    await expect(accepted.handle.result()).resolves.toMatchObject({ status: 'succeeded' });
  } finally {
    vi.useRealTimers();
  }
});

test('projects cancelling, failed, cancelled, and timed_out statuses from lifecycle outcomes', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  output.enqueueTerminalResultRecording();
  output.enqueueTerminalResultRecording();
  output.enqueueTerminalResultRecording();
  output.enqueueTerminalResultRecording();
  execution.enqueueStart('running');
  execution.enqueueStart('running');
  execution.enqueueStart('running');
  execution.enqueueStart('running');
  const clock = new FakeInvocationClock({ initialNowMs: 0 });
  const manager = createLifecycleManager({ execution, clock, output });

  const failed = expectAcceptedInvocation(
    await manager.start(createStartInput({ invocationId: 'failed-snap' })),
  );
  await flush();
  execution.settleCompletionFailure(1, new Error('boom'));
  await flush();
  expectSnapshot(manager, 'failed-snap', 'failed');
  await expect(failed.handle.result()).resolves.toMatchObject({ status: 'failed' });

  const cancelled = expectAcceptedInvocation(
    await manager.start(createStartInput({ invocationId: 'cancelled-snap' })),
  );
  await flush();
  await manager.cancel('cancelled-snap');
  expectSnapshot(manager, 'cancelled-snap', 'cancelling');
  execution.settleCancellationRequest(2);
  execution.confirmCancellation(2);
  await flush();
  expectSnapshot(manager, 'cancelled-snap', 'cancelled');
  await expect(cancelled.handle.result()).resolves.toMatchObject({ status: 'cancelled' });

  const timedOut = expectAcceptedInvocation(
    await manager.start(
      createStartInput({
        invocationId: 'timeout-snap',
        limits: { wallClockTimeoutMs: 1_000, idleTimeoutMs: 1_000 },
      }),
    ),
  );
  await flush();
  clock.advanceBy(1_000);
  await flush();
  expectSnapshot(manager, 'timeout-snap', 'cancelling');
  execution.settleCancellationRequest(3);
  execution.confirmCancellation(3);
  await flush();
  expectSnapshot(manager, 'timeout-snap', 'timed_out');
  await expect(timedOut.handle.result()).resolves.toMatchObject({ status: 'timed_out' });

  const naturalRace = expectAcceptedInvocation(
    await manager.start(createStartInput({ invocationId: 'natural-race-snap' })),
  );
  await flush();
  await expect(manager.cancel('natural-race-snap')).resolves.toEqual({ state: 'requested' });
  execution.settleNaturalCompletion(4, new TextEncoder().encode('{}'));
  await flush();
  expectSnapshot(manager, 'natural-race-snap', 'succeeded');
  await expect(naturalRace.handle.result()).resolves.toMatchObject({ status: 'succeeded' });
});

test('filters invocation snapshots and sorts by acceptedAt with invocationId tie-breaks', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-08-24T00:00:00.000Z'));
  try {
    const execution = new FakeInvocationExecutionPort();
    const output = new FakeInvocationOutputPort();
    const claim = new FakeOutputClaimPort();
    claim.enqueue('pending');
    claim.enqueue('created');
    output.enqueueTerminalResultRecording();
    output.enqueueTerminalResultRecording();
    execution.enqueueStart('running');
    execution.enqueueStart('running');
    const manager = createLifecycleManager({
      execution,
      output,
      outputClaim: claim,
      clock: new FakeInvocationClock({ initialNowMs: 0 }),
    });

    const firstStart = manager.start(createStartInput({ invocationId: 'b-first' }));
    await flush();
    expect(manager.getInvocation('b-first')).toBeUndefined();
    expect(manager.listInvocations()).toEqual([]);

    vi.setSystemTime(new Date('2026-08-24T00:00:01.000Z'));
    const second = expectAcceptedInvocation(
      await manager.start(
        createStartInput({
          invocationId: 'a-second',
          agent: otherAgent,
          output: { directory: '/outputs/a-second' },
        }),
      ),
    );
    await flush();
    expectSnapshot(manager, 'a-second', 'running', otherAgent);

    vi.setSystemTime(new Date('2026-08-24T00:00:02.000Z'));
    claim.settlePendingCreated(1);
    const first = expectAcceptedInvocation(await firstStart);
    await flush();

    const ids = manager.listInvocations().map((snapshot) => snapshot.invocationId);
    expect(ids).toEqual(['a-second', 'b-first']);
    expect(
      manager
        .listInvocations({ statuses: ['running'], agent: otherAgent })
        .map((snapshot) => snapshot.invocationId),
    ).toEqual(['a-second']);
    expect(manager.listInvocations({ invocationId: 'b-first' })).toHaveLength(1);
    expect(manager.listInvocations({ invocationId: 'missing' })).toEqual([]);

    vi.setSystemTime(new Date('2026-08-24T00:00:03.000Z'));
    execution.settleNaturalCompletion(1, new TextEncoder().encode('{}'));
    execution.settleNaturalCompletion(2, new TextEncoder().encode('{}'));
    await flush();
    expect(
      manager.listInvocations({ statuses: ['succeeded'] }).map((snapshot) => snapshot.invocationId),
    ).toEqual(['a-second', 'b-first']);
    await expect(first.handle.result()).resolves.toMatchObject({ status: 'succeeded' });
    await expect(second.handle.result()).resolves.toMatchObject({ status: 'succeeded' });
  } finally {
    vi.useRealTimers();
  }
});

test('keeps finalizing snapshots visible with the last active status and publishes before terminal delivery', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  output.enqueuePendingTerminalResultRecording();
  execution.enqueueStart('running');
  const manager = createLifecycleManager({
    execution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output,
  });
  const accepted = expectAcceptedInvocation(
    await manager.start(createStartInput({ invocationId: 'finalizing-snap' })),
  );
  await flush();
  execution.settleNaturalCompletion(1, new TextEncoder().encode('{}'));
  await flush();
  expect(accepted.lifecycle.currentState()).toBe('finalizing');
  expectSnapshot(manager, 'finalizing-snap', 'running');

  let synchronousSnapshotSeen = false;
  manager.subscribe({}, (event) => {
    const snapshot = manager.getInvocation(event.invocationId);
    expect(snapshot?.status).toBe('succeeded');
    synchronousSnapshotSeen = true;
  });
  output.fulfilPendingTerminalResultRecording(1);
  await flush();
  expect(synchronousSnapshotSeen).toBe(true);
});

test('keeps starting status and undefined finishedAt when finalize itself throws on start failure', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  Object.defineProperty(output, 'cleanupScratch', {
    value: async () => {
      throw new Error('cleanup failed');
    },
  });
  execution.enqueueStart(new Error('spawn failed'));
  const manager = createLifecycleManager({
    execution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output,
  });
  const accepted = expectAcceptedInvocation(
    await manager.start(createStartInput({ invocationId: 'start-failure-finalize' })),
  );
  await flush();
  expect(accepted.lifecycle.currentState()).toBe('terminal');
  const snapshot = expectSnapshot(manager, 'start-failure-finalize', 'failed');
  expect(snapshot.startedAt).toBeUndefined();
  expect(snapshot.finishedAt).toBeUndefined();
});

test('uses invocationId as tie-breaker when acceptedAt timestamps are equal', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-08-24T00:01:00.000Z'));
  try {
    const execution = new FakeInvocationExecutionPort();
    const output = new FakeInvocationOutputPort();
    execution.enqueueStart('running');
    execution.enqueueStart('running');
    const manager = createLifecycleManager({
      execution,
      clock: new FakeInvocationClock({ initialNowMs: 0 }),
      output,
    });

    expectAcceptedInvocation(await manager.start(createStartInput({ invocationId: 'b-tie' })));
    expectAcceptedInvocation(await manager.start(createStartInput({ invocationId: 'a-tie' })));
    await flush();

    expect(manager.listInvocations().map((snapshot) => snapshot.invocationId)).toEqual([
      'a-tie',
      'b-tie',
    ]);
  } finally {
    vi.useRealTimers();
  }
});

test('keeps starting as the finalizing-window active status after execution start throws', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  output.enqueuePendingTerminalResultRecording();
  execution.enqueueStart(new Error('spawn failed'));
  const manager = createLifecycleManager({
    execution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output,
  });

  const accepted = expectAcceptedInvocation(
    await manager.start(createStartInput({ invocationId: 'start-failure-finalizing' })),
  );
  await flush();

  expect(accepted.lifecycle.currentState()).toBe('finalizing');
  expectSnapshot(manager, 'start-failure-finalizing', 'starting');
  output.fulfilPendingTerminalResultRecording(1);
  await flush();
  expectSnapshot(manager, 'start-failure-finalizing', 'failed');
});

test('keeps pending admission out of invocation snapshots until active admission commits', async () => {
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
  const manager = createLifecycleManager({
    execution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output,
    workspace: { admit: async () => workspaceAdmission },
  });

  const start = manager.start(createStartInput({ invocationId: 'pending-snapshot' }));
  await Promise.resolve();

  expect(manager.getInvocation('pending-snapshot')).toBeUndefined();
  expect(manager.listInvocations().map((snapshot) => snapshot.invocationId)).not.toContain(
    'pending-snapshot',
  );

  if (admitWorkspace === undefined) throw new Error('Expected workspace admission resolver.');
  admitWorkspace({ status: 'admitted', directory: '/workspace/project' });
  const accepted = expectAcceptedInvocation(await start);
  await flush();
  expectSnapshot(manager, 'pending-snapshot', 'running');
  execution.settleNaturalCompletion(1, new TextEncoder().encode('{}'));
  await flush();
  await expect(accepted.handle.result()).resolves.toMatchObject({ status: 'succeeded' });
});
