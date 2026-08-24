import { expect, test, vi } from 'vitest';

import { createInvocationLifecycleManager } from '../../../src/application/manager/index.js';
import type {
  InvocationExecutionPorts,
  InvocationInputSnapshot,
  InvocationTerminalObservation,
  PreparedLaunch,
  ProcessCleanupAttemptOutcome,
} from '../../../src/runtime/execution/index.js';
import type { ExecutableProbePort } from '../../../src/runtime/probe/index.js';
import type {
  ActiveInvocationSnapshot,
  ActiveInvocationStateSink,
  ActiveStateOperationContext,
} from '../../../src/runtime/spec/index.js';
import { buildAgentDefinition } from '../../support/definition/build-agent-definition.js';
import { FakeInvocationClock } from '../../support/execution/fake-clock.js';
import { FakeInvocationExecutionPort } from '../../support/execution/fake-execution-port.js';
import { FakeOutputClaimPort } from '../../support/execution/fake-output-claim-port.js';
import { FakeInvocationOutputPort } from '../../support/execution/fake-output-port.js';
import { FakeOutputPreparationPort } from '../../support/execution/fake-output-preparation-port.js';
import { FakeExecutableProbePort } from '../../support/probe/fake-executable-probe-port.js';
import { FreshAvailableExecutableProbePort } from '../../support/probe/fresh-available-executable-probe-port.js';

const cancellationCompletion = (
  outcome:
    | Readonly<{ status: 'committed'; completion: Promise<unknown> }>
    | Readonly<{ status: 'too_late' }>,
): Promise<unknown> => {
  expect(outcome.status).toBe('committed');
  if (outcome.status !== 'committed') throw new Error('Expected committed cancellation.');
  return outcome.completion;
};

const definition = buildAgentDefinition();
const agent = Object.freeze({ id: definition.id, version: definition.version });
const defaultActiveStateSink = Object.freeze({
  save: async (): Promise<void> => undefined,
  remove: async (): Promise<void> => undefined,
});

type LifecycleManagerPortsInput = Omit<
  InvocationExecutionPorts,
  'workspace' | 'outputClaim' | 'outputPreparation'
> &
  Partial<Pick<InvocationExecutionPorts, 'workspace' | 'outputClaim' | 'outputPreparation'>>;
type LifecycleManagerInput = LifecycleManagerPortsInput &
  Readonly<{ executableProbe?: ExecutableProbePort }>;

const createLifecycleManager = (
  ports: LifecycleManagerInput,
  activeStateSink: ActiveInvocationStateSink = defaultActiveStateSink,
  activeStateOperationTimeoutMs?: number,
) =>
  createInvocationLifecycleManager(
    Object.freeze({
      definitions: Object.freeze([definition]),
      activeStateSink,
      ...(activeStateOperationTimeoutMs === undefined
        ? {}
        : { limits: Object.freeze({ activeStateOperationTimeoutMs }) }),
    }),
    {
      ...ports,
      executableProbe:
        ports.executableProbe ??
        new FreshAvailableExecutableProbePort('/resolved/fixture-agent', '1.0.0'),
      outputClaim: ports.outputClaim ?? new FakeOutputClaimPort('created'),
      outputPreparation: ports.outputPreparation ?? new FakeOutputPreparationPort('prepared'),
      workspace: ports.workspace ?? {
        admit: async () => ({ status: 'admitted', directory: '/workspace/project' }),
      },
    },
  );

const resultSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
};

test('rejects an invalid request before output preparation or execution start', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  output.enqueueTerminalResultRecording();
  const manager = createLifecycleManager({
    execution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output,
  });

  await expect(manager.start(createStartInput({ invocationId: '' }))).resolves.toEqual({
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
  const manager = createLifecycleManager({
    execution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output,
  });

  const [first, second] = await Promise.all([
    manager.start(createStartInput({ invocationId: 'same', metadata })),
    manager.start(createStartInput({ invocationId: 'same', metadata })),
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
  const outputPreparation = new FakeOutputPreparationPort();
  outputPreparation.enqueue('scratch-create-failed');
  const manager = createLifecycleManager({
    execution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output,
    outputPreparation,
  });

  await expect(
    manager.start(createStartInput({ invocationId: 'prepare-failure' })),
  ).resolves.toEqual({
    status: 'rejected',
    reason: 'output_prepare_failed',
  });
  expect(execution.calls()).toEqual([]);
});

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

interface TestDeferred<Value> {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
  readonly reject: (reason: Error) => void;
}

const testDeferred = <Value>(): TestDeferred<Value> => {
  let resolve: ((value: Value) => void) | undefined;
  let reject: ((reason: Error) => void) | undefined;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  if (resolve === undefined || reject === undefined)
    throw new Error('Unable to create test deferred.');
  return Object.freeze({ promise, resolve, reject });
};

const availableProbeExit = () =>
  Object.freeze({
    status: 'exited' as const,
    exitCode: 0,
    signal: null,
    stdout: new TextEncoder().encode('agent 1.0.0\n'),
    stderr: new Uint8Array(),
    overflow: 'none' as const,
  });

const waitUntil = async (predicate: () => boolean, remaining = 100): Promise<void> => {
  if (predicate()) return;
  if (remaining > 0) {
    await Promise.resolve();
    await waitUntil(predicate, remaining - 1);
    return;
  }
  expect(predicate()).toBe(true);
};

test('saves running active state before acceptance and activates only after save fulfils', async () => {
  const calls: string[] = [];
  const save = testDeferred<void>();
  const completion = testDeferred<InvocationTerminalObservation>();
  const output = new FakeInvocationOutputPort();
  const execution: InvocationExecutionPorts['execution'] = {
    spawnAndIdentify: async () => {
      calls.push('spawn-and-identify');
      return Object.freeze({
        status: 'identified' as const,
        spawnedAt: Date.now(),
        startedAt: '2026-08-24T10:00:00.000Z',
        identity: Object.freeze({
          pid: 123,
          processGroupId: 123,
          fingerprint: 'sha256:fixture',
        }),
        activate: () => {
          calls.push('activate');
          return Object.freeze({
            spawnedAt: Date.now(),
            completion: completion.promise,
            requestCancellation: async () => undefined,
          });
        },
        killAndReap: async () => undefined,
      });
    },
  };
  const activeStateSink = Object.freeze({
    save: async (snapshot: unknown): Promise<void> => {
      calls.push('save-running');
      expect(snapshot).toMatchObject({
        invocationId: 'save-before-acceptance',
        state: 'running',
        process: {
          pid: 123,
          processGroupId: 123,
          fingerprint: 'sha256:fixture',
          startedAt: '2026-08-24T10:00:00.000Z',
        },
      });
      await save.promise;
    },
    remove: async (): Promise<void> => undefined,
  });
  const manager = createLifecycleManager(
    {
      execution,
      clock: new FakeInvocationClock({ initialNowMs: 0 }),
      output,
    },
    activeStateSink,
  );

  const start = manager.start(createStartInput({ invocationId: 'save-before-acceptance' }));
  await waitUntil(() => calls.includes('save-running'));

  expect(calls).toEqual(['spawn-and-identify', 'save-running']);
  expect(manager.getInvocation('save-before-acceptance')).toBeUndefined();
  save.resolve(undefined);

  await expect(start).resolves.toMatchObject({ status: 'accepted' });
  expect(calls).toEqual(['spawn-and-identify', 'save-running', 'activate']);
});

test('kills without saving when shutdown closes the manager during spawn and identity', async () => {
  const identified = testDeferred<void>();
  const calls: string[] = [];
  const execution: InvocationExecutionPorts['execution'] = {
    spawnAndIdentify: async () => {
      calls.push('spawn-and-identify');
      await identified.promise;
      return Object.freeze({
        status: 'identified' as const,
        spawnedAt: Date.now(),
        startedAt: '2026-08-24T10:00:00.000Z',
        identity: Object.freeze({ pid: 201, processGroupId: 201, fingerprint: 'sha256:201' }),
        activate: () => {
          throw new Error('Closing manager must not activate.');
        },
        killAndReap: async () => {
          calls.push('kill-and-reap');
          return undefined;
        },
      });
    },
  };
  const sink: ActiveInvocationStateSink = Object.freeze({
    save: async () => {
      calls.push('save');
    },
    remove: async () => {
      calls.push('remove');
    },
  });
  const manager = createLifecycleManager(
    {
      execution,
      clock: new FakeInvocationClock({ initialNowMs: 0 }),
      output: new FakeInvocationOutputPort(),
    },
    sink,
  );

  const start = manager.start(createStartInput({ invocationId: 'closing-during-spawn' }));
  await waitUntil(() => calls.includes('spawn-and-identify'));
  const shutdown = manager.shutdown();
  identified.resolve(undefined);

  await expect(start).resolves.toEqual({ status: 'rejected', reason: 'manager_closed' });
  await expect(shutdown).resolves.toBeUndefined();
  expect(calls).toEqual(['spawn-and-identify', 'kill-and-reap']);
});

test('kills and removes the saved row when shutdown closes the manager during save', async () => {
  const save = testDeferred<void>();
  const calls: string[] = [];
  const execution: InvocationExecutionPorts['execution'] = {
    spawnAndIdentify: async () => ({
      status: 'identified' as const,
      spawnedAt: Date.now(),
      startedAt: '2026-08-24T10:00:00.000Z',
      identity: Object.freeze({ pid: 202, processGroupId: 202, fingerprint: 'sha256:202' }),
      activate: () => {
        throw new Error('Closing manager must not activate.');
      },
      killAndReap: async () => {
        calls.push('kill-and-reap');
        return undefined;
      },
    }),
  };
  const sink: ActiveInvocationStateSink = Object.freeze({
    save: async () => {
      calls.push('save');
      await save.promise;
    },
    remove: async () => {
      calls.push('remove');
    },
  });
  const manager = createLifecycleManager(
    {
      execution,
      clock: new FakeInvocationClock({ initialNowMs: 0 }),
      output: new FakeInvocationOutputPort(),
    },
    sink,
  );

  const start = manager.start(createStartInput({ invocationId: 'closing-during-save' }));
  await waitUntil(() => calls.includes('save'));
  const shutdown = manager.shutdown();
  save.resolve(undefined);

  await expect(start).resolves.toEqual({ status: 'rejected', reason: 'manager_closed' });
  await expect(shutdown).resolves.toBeUndefined();
  expect(calls).toEqual(['save', 'kill-and-reap', 'remove']);
});

test('retains invocation and output-directory guards after a rejected running save', async () => {
  const remove = vi.fn(async (): Promise<void> => undefined);
  const execution = new FakeInvocationExecutionPort();
  execution.enqueueStart('running');
  const manager = createLifecycleManager(
    {
      execution,
      clock: new FakeInvocationClock({ initialNowMs: 0 }),
      output: new FakeInvocationOutputPort(),
    },
    Object.freeze({
      save: async (): Promise<void> => {
        throw new Error('save rejected');
      },
      remove,
    }),
  );

  await expect(
    manager.start(createStartInput({ invocationId: 'retained-active-row' })),
  ).resolves.toEqual({
    status: 'rejected',
    reason: 'active_state_failed',
  });
  await expect(
    manager.start(createStartInput({ invocationId: 'retained-active-row' })),
  ).resolves.toEqual({
    status: 'rejected',
    reason: 'duplicate_invocation',
  });
  await expect(
    manager.start(
      createStartInput({
        invocationId: 'different-id-same-output',
        output: Object.freeze({ directory: '/outputs/invocation' }),
      }),
    ),
  ).resolves.toEqual({ status: 'rejected', reason: 'active_state_failed' });
  expect(remove).not.toHaveBeenCalled();
});

test('quarantines the output directory when terminal active-state removal rejects', async () => {
  const execution = new FakeInvocationExecutionPort();
  execution.enqueueStart('running');
  const output = new FakeInvocationOutputPort();
  output.enqueueTerminalResultRecording();
  const manager = createLifecycleManager(
    {
      execution,
      clock: new FakeInvocationClock({ initialNowMs: 0 }),
      output,
    },
    Object.freeze({
      save: async (): Promise<void> => undefined,
      remove: async (): Promise<void> => {
        throw new Error('remove rejected');
      },
    }),
  );

  const accepted = await manager.start(createStartInput({ invocationId: 'remove-rejected' }));
  expect(accepted.status).toBe('accepted');
  if (accepted.status !== 'accepted') throw new Error('Expected accepted invocation.');
  execution.settleNaturalCompletion(1, new TextEncoder().encode('{}'));
  await flush();
  await expect(accepted.handle.result()).resolves.toMatchObject({ status: 'succeeded' });

  await expect(
    manager.start(
      createStartInput({
        invocationId: 'same-output-after-remove-rejection',
        output: Object.freeze({ directory: '/outputs/invocation' }),
      }),
    ),
  ).resolves.toEqual({ status: 'rejected', reason: 'active_state_failed' });
});

test('clamps running-save timeout to the earlier preacceptance deadline', async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(123_456);
    let saveSignal: AbortSignal | undefined;
    const execution = new FakeInvocationExecutionPort();
    execution.enqueueStart('running');
    const manager = createLifecycleManager(
      {
        execution,
        clock: new FakeInvocationClock({ initialNowMs: 123_456 }),
        output: new FakeInvocationOutputPort(),
      },
      Object.freeze({
        save: (_snapshot: ActiveInvocationSnapshot, context: ActiveStateOperationContext) => {
          saveSignal = context.signal;
          return new Promise<void>(() => undefined);
        },
        remove: async (): Promise<void> => undefined,
      }),
      30_000,
    );

    const start = manager.start(
      createStartInput({
        invocationId: 'save-deadline-clamp',
        limits: Object.freeze({ wallClockTimeoutMs: 1_000, idleTimeoutMs: 1_000 }),
      }),
    );
    await vi.advanceTimersByTimeAsync(999);
    expect(saveSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(saveSignal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(30_000);

    await expect(start).resolves.toEqual({ status: 'rejected', reason: 'active_state_failed' });
  } finally {
    vi.useRealTimers();
  }
});

test('prepared output settlement reaches accepted start and delegates unchanged prepared launch to execution', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  const outputPreparation = new FakeOutputPreparationPort('prepared');
  output.enqueueTerminalResultRecording();
  execution.enqueueStart('running');
  const manager = createLifecycleManager({
    execution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output,
    outputPreparation,
  });

  await expect(
    manager.start(createStartInput({ invocationId: 'prepared-output' })),
  ).resolves.toMatchObject({
    status: 'accepted',
  });
  expect(outputPreparation.requests()).toHaveLength(1);
  expect(execution.calls()).toEqual([{ type: 'start' }]);
});

test('passes prepared invocation resources as the third execution start argument', async () => {
  const output = new FakeInvocationOutputPort();
  const outputPreparation = new FakeOutputPreparationPort('prepared');
  output.enqueueTerminalResultRecording();
  const starts: Array<
    readonly [
      InvocationInputSnapshot,
      PreparedLaunch,
      NonNullable<Parameters<InvocationExecutionPorts['execution']['spawnAndIdentify']>[2]>,
    ]
  > = [];
  const execution: InvocationExecutionPorts['execution'] = {
    spawnAndIdentify: async (snapshot, preparedLaunch, resources) => {
      if (resources === undefined) throw new Error('Expected prepared resources.');
      starts.push([snapshot, preparedLaunch, resources]);
      return {
        status: 'identified',
        spawnedAt: 123_456,
        startedAt: '1970-01-01T00:02:03.456Z',
        identity: Object.freeze({ pid: 1, processGroupId: 1, fingerprint: 'sha256:fixture' }),
        activate: () => ({
          spawnedAt: 123_456,
          completion: Promise.resolve({
            status: 'completed',
            spawnedAt: 123_456,
            exit: Object.freeze({ exitCode: 0, signal: null }),
          } satisfies InvocationTerminalObservation),
          requestCancellation: async () => undefined,
        }),
        killAndReap: async () => undefined,
      };
    },
  };
  const manager = createLifecycleManager({
    execution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output,
    outputPreparation,
  });

  await expect(
    manager.start(createStartInput({ invocationId: 'prepared-resources-threading' })),
  ).resolves.toMatchObject({ status: 'accepted' });

  expect(starts).toHaveLength(1);
  expect(starts[0]?.[2].frontEnds.stdout).toBeDefined();
  expect(starts[0]?.[2].evidenceSinks.stdout).toBeDefined();
});
test('uncertain output preparation quarantines the invocation id and output directory', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  const outputPreparation = new FakeOutputPreparationPort('throw-after-dispatch');
  const manager = createLifecycleManager({
    execution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output,
    outputPreparation,
  });

  await expect(
    manager.start(
      createStartInput({
        invocationId: 'uncertain-preparation',
        output: { directory: '/out/uncertain' },
      }),
    ),
  ).resolves.toEqual({
    status: 'rejected',
    reason: 'output_prepare_uncertain',
  });
  expect(execution.calls()).toEqual([]);
  await expect(
    manager.start(
      createStartInput({
        invocationId: 'uncertain-preparation',
        output: { directory: '/out/other' },
      }),
    ),
  ).resolves.toMatchObject({ status: 'rejected', reason: 'duplicate_invocation' });
  await expect(
    manager.start(
      createStartInput({
        invocationId: 'contender-preparation',
        output: { directory: '/out/uncertain' },
      }),
    ),
  ).resolves.toMatchObject({ status: 'rejected', reason: 'output_prepare_uncertain' });
});

test('retains an id after terminal settlement until FIFO eviction', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  output.enqueueTerminalResultRecording();
  execution.enqueueStart('running');
  execution.enqueueStart('running');
  const manager = createLifecycleManager({
    execution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output,
  });

  const first = await manager.start(createStartInput({ invocationId: 'reused' }));
  if (first.status !== 'accepted') throw new Error('Expected first admission');
  await flush();
  execution.settleNaturalCompletion(1, new TextEncoder().encode('{}'));
  await flush();
  const second = await manager.start(createStartInput({ invocationId: 'reused' }));

  expect(second).toEqual({ status: 'rejected', reason: 'duplicate_invocation' });
  expect(execution.calls()).toEqual([{ type: 'start' }]);
});

const expectAccepted = (
  outcome: Awaited<ReturnType<ReturnType<typeof createInvocationLifecycleManager>['start']>>,
) => {
  if (outcome.status !== 'accepted') throw new Error('Expected accepted invocation');
  return outcome.lifecycle;
};

test('retains failed composition admission after completion rejection', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  output.enqueueTerminalResultRecording();
  execution.enqueueStart('running');
  execution.enqueueStart('running');
  const manager = createLifecycleManager({
    execution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output,
  });

  const lifecycle = expectAccepted(
    await manager.start(createStartInput({ invocationId: 'failed-reuse' })),
  );
  await flush();
  execution.settleCompletionFailure(1, new Error('failed'));
  await flush();
  expect(lifecycle.terminalSettlement()).toMatchObject({ status: 'failed' });
  await expect(manager.start(createStartInput({ invocationId: 'failed-reuse' }))).resolves.toEqual({
    status: 'rejected',
    reason: 'duplicate_invocation',
  });
});

test('retains caller-cancelled composition admission after confirmed cancellation', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  output.enqueueTerminalResultRecording();
  execution.enqueueStart('running');
  execution.enqueueStart('running');
  const manager = createLifecycleManager({
    execution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output,
  });

  const lifecycle = expectAccepted(
    await manager.start(createStartInput({ invocationId: 'cancelled-reuse' })),
  );
  await flush();
  const cancellation = lifecycle.requestCancellation();
  await flush();
  execution.settleCancellationRequest(1);
  await cancellationCompletion(cancellation);
  await expect(
    manager.start(createStartInput({ invocationId: 'cancelled-reuse' })),
  ).resolves.toEqual({
    status: 'rejected',
    reason: 'duplicate_invocation',
  });
  execution.confirmCancellation(1);
  await flush();
  expect(lifecycle.terminalSettlement()).toMatchObject({ status: 'cancelled' });
  await expect(
    manager.start(createStartInput({ invocationId: 'cancelled-reuse' })),
  ).resolves.toEqual({
    status: 'rejected',
    reason: 'duplicate_invocation',
  });
});

test('retains deadline-cancelled composition admission after confirmed cancellation', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  output.enqueueTerminalResultRecording();
  const clock = new FakeInvocationClock({ initialNowMs: 0 });
  execution.enqueueStart('running');
  execution.enqueueStart('running');
  const manager = createLifecycleManager({ execution, clock, output });

  const lifecycle = expectAccepted(
    await manager.start(
      createStartInput({
        invocationId: 'timeout-reuse',
        limits: { wallClockTimeoutMs: 1_000, idleTimeoutMs: 1_000 },
      }),
    ),
  );
  await flush();
  clock.advanceBy(1_000);
  await flush();
  await expect(manager.start(createStartInput({ invocationId: 'timeout-reuse' }))).resolves.toEqual(
    {
      status: 'rejected',
      reason: 'duplicate_invocation',
    },
  );
  execution.settleCancellationRequest(1);
  execution.confirmCancellation(1);
  await flush();
  expect(lifecycle.terminalSettlement()).toMatchObject({ status: 'timed_out' });
  await expect(manager.start(createStartInput({ invocationId: 'timeout-reuse' }))).resolves.toEqual(
    {
      status: 'rejected',
      reason: 'duplicate_invocation',
    },
  );
});

test('keeps a racing natural completion as the only terminal composition settlement', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  output.enqueueTerminalResultRecording();
  execution.enqueueStart('running');
  execution.enqueueStart('running');
  const manager = createLifecycleManager({
    execution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output,
  });

  const lifecycle = expectAccepted(
    await manager.start(createStartInput({ invocationId: 'race-reuse' })),
  );
  await flush();
  const cancellation = lifecycle.requestCancellation();
  await flush();
  execution.settleNaturalCompletion(1, new TextEncoder().encode('{}'));
  await expect(cancellationCompletion(cancellation)).rejects.toThrow(
    'Execution completed before cancellation request was accepted',
  );
  await flush();
  expect(lifecycle.terminalSettlement()).toMatchObject({ status: 'succeeded', value: {} });
  await expect(manager.start(createStartInput({ invocationId: 'race-reuse' }))).resolves.toEqual({
    status: 'rejected',
    reason: 'duplicate_invocation',
  });
});

test('keeps an id active until its one pending terminal-result commit settles', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  const clock = new FakeInvocationClock({ initialNowMs: 0 });
  execution.enqueueStart('running');
  execution.enqueueStart('running');
  output.enqueuePendingTerminalResultRecording();
  const manager = createLifecycleManager({ execution, clock, output });

  const first = expectAccepted(
    await manager.start(createStartInput({ invocationId: 'finalizing' })),
  );
  await flush();
  execution.settleNaturalCompletion(1, new TextEncoder().encode('{"ok":true}'));
  await flush();

  expect(first.currentState()).toBe('finalizing');
  await expect(manager.start(createStartInput({ invocationId: 'finalizing' }))).resolves.toEqual({
    status: 'rejected',
    reason: 'duplicate_invocation',
  });
  expect(output.calls().filter((call) => call.type === 'publish-terminal-result')).toHaveLength(1);

  output.fulfilPendingTerminalResultRecording(1);
  await flush();
  expect(first.terminalSettlement()).toMatchObject({ status: 'succeeded', value: { ok: true } });
  await expect(manager.start(createStartInput({ invocationId: 'finalizing' }))).resolves.toEqual({
    status: 'rejected',
    reason: 'duplicate_invocation',
  });
});

test('retains the id after one output commit failure without retrying the commit', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  execution.enqueueStart('running');
  execution.enqueueStart('running');
  output.enqueueTerminalResultRecording(new Error('write failed'));
  const manager = createLifecycleManager({
    execution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output,
  });

  const lifecycle = expectAccepted(
    await manager.start(createStartInput({ invocationId: 'output-failure' })),
  );
  await flush();
  execution.settleNaturalCompletion(1, new TextEncoder().encode('{"ok":true}'));
  await flush();

  expect(lifecycle.terminalSettlement()).toMatchObject({ status: 'failed' });
  expect(output.calls().filter((call) => call.type === 'publish-terminal-result')).toHaveLength(1);
  await expect(
    manager.start(createStartInput({ invocationId: 'output-failure' })),
  ).resolves.toEqual({
    status: 'rejected',
    reason: 'duplicate_invocation',
  });
});

const cleanupFailure = (): ProcessCleanupAttemptOutcome =>
  Object.freeze({
    cause: 'group_still_live',
    termSent: true,
    killSent: true,
    lastKnownGroupState: 'present',
    leaderReapState: 'pending',
  });

test('shutdown is idempotent and drains active invocations through cleanup settlement before completion', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  output.enqueueTerminalResultRecording();
  output.enqueueTerminalResultRecording();
  execution.enqueueStart('running');
  execution.enqueueStart('running');
  const manager = createLifecycleManager({
    execution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output,
  });
  await expect(
    manager.start(createStartInput({ invocationId: 'shutdown-a' })),
  ).resolves.toMatchObject({
    status: 'accepted',
  });
  await expect(
    manager.start(createStartInput({ invocationId: 'shutdown-b' })),
  ).resolves.toMatchObject({
    status: 'accepted',
  });
  await flush();

  const first = manager.shutdown('first reason');
  const second = manager.shutdown('ignored reason');

  expect(second).toBe(first);
  await flush();
  expect(execution.calls()).toEqual([
    { type: 'start' },
    { type: 'start' },
    { type: 'request-cancellation', executionId: 1 },
    { type: 'request-cancellation', executionId: 2 },
  ]);
  execution.settleCancellationRequest(1);
  execution.settleCancellationRequest(2);
  await flush();
  expect(manager.getResult('shutdown-a')).toEqual({ state: 'active' });
  execution.confirmCancellation(1);
  execution.confirmCancellation(2);
  await expect(first).resolves.toBeUndefined();
  expect(manager.getResult('shutdown-a')).toMatchObject({ state: 'completed' });
  expect(manager.getResult('shutdown-b')).toMatchObject({ state: 'completed' });
});

test('shutdown rejects with shutdown_failed on cleanup failure without deleting the active invocation', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  output.enqueueTerminalResultRecording();
  execution.enqueueStart('running');
  const manager = createLifecycleManager({
    execution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output,
  });
  await expect(
    manager.start(createStartInput({ invocationId: 'shutdown-cleanup-failed' })),
  ).resolves.toMatchObject({ status: 'accepted' });
  await flush();

  const shutdown = manager.shutdown('cleanup failed');
  await flush();
  execution.settleCancellationRequest(1, cleanupFailure());

  await expect(shutdown).rejects.toMatchObject({
    fault: { code: 'revo.agent.shutdown_failed', phase: 'shutdown', retryable: false },
  });
  expect(manager.getResult('shutdown-cleanup-failed')).toEqual({ state: 'active' });
  expect(manager.getInvocation('shutdown-cleanup-failed')).toMatchObject({
    invocationId: 'shutdown-cleanup-failed',
    status: 'cancelling',
  });
});

test('shutdown does not reject when invocation execution fails after confirmed cleanup', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  output.enqueueTerminalResultRecording();
  execution.enqueueStart('running');
  const manager = createLifecycleManager({
    execution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output,
  });
  await expect(
    manager.start(createStartInput({ invocationId: 'shutdown-execution-failed' })),
  ).resolves.toMatchObject({ status: 'accepted' });
  await flush();

  const shutdown = manager.shutdown('stop');
  await flush();
  execution.settleCancellationRequest(1);
  execution.settleCompletionFailure(1, new Error('execution failed'));

  await expect(shutdown).resolves.toBeUndefined();
  expect(manager.getResult('shutdown-execution-failed')).toMatchObject({ state: 'completed' });
});

test('shutdown rejects new starts and new subscriptions while existing reads and cancel stay usable', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  output.enqueueTerminalResultRecording();
  execution.enqueueStart('running');
  const manager = createLifecycleManager({
    execution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output,
  });
  const accepted = await manager.start(createStartInput({ invocationId: 'shutdown-reads' }));
  if (accepted.status !== 'accepted') throw new Error('Expected accepted invocation.');
  await flush();

  const shutdown = manager.shutdown('closing');
  expect(() => manager.subscribe({}, () => undefined)).toThrow('Agent manager is closed.');
  await expect(manager.start(createStartInput({ invocationId: 'after-close' }))).resolves.toEqual({
    status: 'rejected',
    reason: 'manager_closed',
  });
  expect(manager.getInvocation('shutdown-reads')).toMatchObject({ invocationId: 'shutdown-reads' });
  expect(manager.listInvocations({ invocationId: 'shutdown-reads' })).toHaveLength(1);
  expect(manager.getResult('shutdown-reads')).toEqual({ state: 'active' });
  await expect(manager.cancel('shutdown-reads')).resolves.toEqual({ state: 'requested' });

  execution.settleCancellationRequest(1);
  execution.confirmCancellation(1);
  await expect(shutdown).resolves.toBeUndefined();
  await expect(accepted.handle.result()).resolves.toMatchObject({ status: 'cancelled' });
});

test('shutdown arbitration rejects a start waiting at workspace admission', async () => {
  const workspaceAdmission =
    testDeferred<Awaited<ReturnType<InvocationExecutionPorts['workspace']['admit']>>>();
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  const manager = createLifecycleManager({
    execution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output,
    workspace: { admit: async () => workspaceAdmission.promise },
  });

  const start = manager.start(createStartInput({ invocationId: 'closing-at-workspace' }));
  await flush();
  const shutdown = manager.shutdown('closing');
  workspaceAdmission.resolve({ status: 'admitted', directory: '/workspace/project' });

  await expect(start).resolves.toEqual({ status: 'rejected', reason: 'preflight_failed' });
  await expect(shutdown).resolves.toBeUndefined();
  expect(execution.calls()).toEqual([]);
  expect(manager.getResult('closing-at-workspace')).toEqual({ state: 'unknown' });
});

test('shutdown arbitration rejects a start waiting at output admission', async () => {
  const outputAdmission = testDeferred<void>();
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  const delayedOutput: InvocationExecutionPorts['output'] = Object.freeze({
    admit: async (request: Parameters<InvocationExecutionPorts['output']['admit']>[0]) =>
      outputAdmission.promise.then(() =>
        Object.freeze({ status: 'admitted' as const, plan: Object.freeze({ ...request }) }),
      ),
    appendLifecycleEvent: output.appendLifecycleEvent.bind(output),
    publishTerminalResult: output.publishTerminalResult.bind(output),
    publishRawResponse: output.publishRawResponse.bind(output),
    cleanupScratch: output.cleanupScratch.bind(output),
  });
  const manager = createLifecycleManager({
    execution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output: delayedOutput,
  });

  const start = manager.start(createStartInput({ invocationId: 'closing-at-output-admit' }));
  await flush();
  const shutdown = manager.shutdown('closing');
  outputAdmission.resolve(undefined);

  await expect(start).resolves.toEqual({ status: 'rejected', reason: 'preflight_failed' });
  await expect(shutdown).resolves.toBeUndefined();
  expect(execution.calls()).toEqual([]);
  expect(manager.getResult('closing-at-output-admit')).toEqual({ state: 'unknown' });
});

test('shutdown arbitration rejects a start waiting at executable probe', async () => {
  const probe = new FakeExecutableProbePort({ platform: 'linux' });
  probe.enqueueResolution({ status: 'resolved', executable: '/resolved/fixture-agent' });
  probe.enqueueVersionStart('running');
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  const manager = createLifecycleManager({
    execution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output,
    executableProbe: probe,
  });

  const start = manager.start(createStartInput({ invocationId: 'closing-at-probe' }));
  await flush();
  const shutdown = manager.shutdown('closing');
  probe.settleCompletion(1, availableProbeExit());

  await expect(start).resolves.toEqual({ status: 'rejected', reason: 'preflight_failed' });
  await expect(shutdown).resolves.toBeUndefined();
  expect(execution.calls()).toEqual([]);
  expect(manager.getResult('closing-at-probe')).toEqual({ state: 'unknown' });
});

test('shutdown arbitration rejects and drains a start waiting at output claim', async () => {
  const outputClaim = new FakeOutputClaimPort('pending');
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  const manager = createLifecycleManager({
    execution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output,
    outputClaim,
  });

  const start = manager.start(createStartInput({ invocationId: 'closing-at-claim' }));
  await waitUntil(() => outputClaim.pendingClaimCount() === 1);
  expect(outputClaim.pendingClaimCount()).toBe(1);
  const shutdown = manager.shutdown('closing');
  outputClaim.settlePendingCreated(1);

  await expect(start).resolves.toEqual({ status: 'rejected', reason: 'output_claim_failed' });
  await expect(shutdown).resolves.toBeUndefined();
  expect(outputClaim.pendingClaimCount()).toBe(0);
  expect(execution.calls()).toEqual([]);
  expect(manager.getResult('closing-at-claim')).toEqual({ state: 'unknown' });
});

test('shutdown arbitration rejects and quarantines a start waiting at output preparation settlement', async () => {
  const outputPreparation = new FakeOutputPreparationPort('pending');
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  const manager = createLifecycleManager({
    execution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output,
    outputPreparation,
  });

  const start = manager.start(createStartInput({ invocationId: 'closing-at-preparation' }));
  await waitUntil(() => outputPreparation.pendingPreparationCount() === 1);
  expect(outputPreparation.pendingPreparationCount()).toBe(1);
  const shutdown = manager.shutdown('closing');
  outputPreparation.settlePendingPrepared(1);

  await expect(start).resolves.toEqual({
    status: 'rejected',
    reason: 'output_prepare_uncertain',
  });
  await expect(shutdown).resolves.toBeUndefined();
  expect(outputPreparation.pendingPreparationCount()).toBe(0);
  expect(execution.calls()).toEqual([]);
  await expect(
    manager.start(
      createStartInput({
        invocationId: 'closing-at-preparation',
        output: { directory: '/outputs/other' },
      }),
    ),
  ).resolves.toEqual({ status: 'rejected', reason: 'manager_closed' });
});

test('shutdown arbitration rejects at the final synchronous active-install boundary', async () => {
  const outputPreparation = new FakeOutputPreparationPort('pending');
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  const manager = createLifecycleManager({
    execution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output,
    outputPreparation,
  });

  const start = manager.start(createStartInput({ invocationId: 'closing-before-active' }));
  await waitUntil(() => outputPreparation.pendingPreparationCount() === 1);
  outputPreparation.settlePendingPrepared(1);
  const shutdown = manager.shutdown('closing');

  await expect(start).resolves.toEqual({
    status: 'rejected',
    reason: 'output_prepare_uncertain',
  });
  await expect(shutdown).resolves.toBeUndefined();
  expect(execution.calls()).toEqual([]);
  expect(manager.getResult('closing-before-active')).toEqual({ state: 'unknown' });
});

test('shutdown delivers the last terminal event to existing subscriptions before clearing them', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  output.enqueueTerminalResultRecording();
  execution.enqueueStart('running');
  const manager = createLifecycleManager({
    execution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output,
  });
  await expect(
    manager.start(createStartInput({ invocationId: 'shutdown-terminal-event' })),
  ).resolves.toMatchObject({ status: 'accepted' });
  await flush();
  const events: string[] = [];
  const admission = manager.subscribe({}, (event) => events.push(event.invocationId));
  expect(admission.state).toBe('subscribed');

  const shutdown = manager.shutdown('closing');
  await flush();
  execution.settleCancellationRequest(1);
  execution.confirmCancellation(1);
  await expect(shutdown).resolves.toBeUndefined();

  expect(events).toEqual(['shutdown-terminal-event']);
});

test('rejects an out-of-profile result schema before output preparation or execution start', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  const manager = createLifecycleManager({
    execution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output,
  });

  await expect(
    manager.start(
      createStartInput({
        invocationId: 'invalid-schema',
        result: {
          schema: { $schema: 'https://json-schema.org/draft/2020-12/schema', format: 'email' },
        },
      }),
    ),
  ).resolves.toMatchObject({ status: 'rejected', reason: 'invalid_result_schema' });
  expect(output.calls()).toEqual([]);
  expect(execution.calls()).toEqual([]);
});

test('checks retained invocation ids before rejecting an invalid result schema', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  execution.enqueueStart('running');
  output.enqueueTerminalResultRecording();
  const manager = createLifecycleManager({
    execution,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    output,
  });

  const accepted = expectAccepted(
    await manager.start(createStartInput({ invocationId: 'retained-before-schema' })),
  );
  await flush();
  execution.settleNaturalCompletion(1, new TextEncoder().encode('{"ok":true}'));
  await flush();
  expect(accepted.terminalSettlement()).toMatchObject({ status: 'succeeded', value: { ok: true } });

  await expect(
    manager.start(
      createStartInput({
        invocationId: 'retained-before-schema',
        result: {
          schema: { $schema: 'https://json-schema.org/draft/2020-12/schema', format: 'email' },
        },
      }),
    ),
  ).resolves.toMatchObject({ status: 'rejected', reason: 'duplicate_invocation' });
});

test('finalizes a deep in-bound response with one output commit before retaining its id', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  const clock = new FakeInvocationClock({ initialNowMs: 0 });
  const depth = 20_000;
  const response = new TextEncoder().encode(`${'{"next":'.repeat(depth)}{}${'}'.repeat(depth)}`);
  execution.enqueueStart('running');
  execution.enqueueStart('running');
  output.enqueuePendingTerminalResultRecording();
  const manager = createLifecycleManager({ execution, clock, output });

  const lifecycle = expectAccepted(
    await manager.start(createStartInput({ invocationId: 'deep-result' })),
  );
  await flush();
  execution.settleNaturalCompletion(1, response);
  await flush();

  expect(response.byteLength).toBeLessThan(1_048_576);
  expect(lifecycle.currentState()).toBe('finalizing');
  expect(output.calls().filter((call) => call.type === 'publish-terminal-result')).toHaveLength(1);
  await expect(manager.start(createStartInput({ invocationId: 'deep-result' }))).resolves.toEqual({
    status: 'rejected',
    reason: 'duplicate_invocation',
  });

  output.fulfilPendingTerminalResultRecording(1);
  await flush();
  expect(lifecycle.currentState()).toBe('terminal');
  expect(lifecycle.terminalSettlement()?.status).toBe('succeeded');
  await expect(manager.start(createStartInput({ invocationId: 'deep-result' }))).resolves.toEqual({
    status: 'rejected',
    reason: 'duplicate_invocation',
  });
});
