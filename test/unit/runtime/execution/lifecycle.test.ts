import { expect, test } from 'vitest';

import {
  ExecutionBindingToken,
  InvocationInputSnapshot,
  InvocationLifecycle,
  PreparedLaunch,
} from '../../../../src/runtime/execution/index.js';
import { FakeInvocationClock } from '../../../support/execution/fake-clock.js';
import { FakeInvocationExecutionPort } from '../../../support/execution/fake-execution-port.js';
import { FakeOutputClaimPort } from '../../../support/execution/fake-output-claim-port.js';
import { FakeInvocationOutputPort } from '../../../support/execution/fake-output-port.js';
import { FakeOutputPreparationPort } from '../../../support/execution/fake-output-preparation-port.js';

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const snapshot = (): InvocationInputSnapshot => {
  const value = InvocationInputSnapshot.create({
    invocationId: 'lifecycle',
    agent: { id: 'codex', version: '1.0.0' },
    prompt: 'Return JSON.',
    workspace: { directory: '/workspace/project' },
    parameters: {},
    permissions: {},
    result: { schema: resultSchema },
    output: { directory: '/outputs/invocation' },
    limits: { wallClockTimeoutMs: 1_000, idleTimeoutMs: 1_000 },
  });
  if (value === undefined) throw new Error('Unable to create test snapshot');
  return value;
};

const preparedLaunch = (): PreparedLaunch => {
  const value = PreparedLaunch.create({
    pin: {
      agentId: 'codex',
      agentVersion: '1.0.0',
      definitionDigest: 'definition-digest',
    },
    executable: '/usr/bin/codex',
    reportedVersion: '1.2.3',
    limits: snapshot().limits,
    effectiveParameters: {},
    effectivePermissions: {},
    childEnvironment: {},
    childEnvironmentSecretValues: [],
    secretValues: [],
    resultSchemaValidator,
    outputResourcePlan: {
      invocationId: 'test-invocation',
      outputDirectory: '/outputs/invocation',
      needsPromptFile: false,
      needsResultSchemaFile: false,
    },
    interpretedArgumentTemplate: [{ kind: 'arguments', arguments: ['exec'] }],
    preparedPayloads: { arguments: ['exec'], files: [] },
    binding: {
      protocolDriverId: 'native/stdio-v1',
      resultParserId: 'codex-jsonl/v1',
      permissionStrategyId: 'codex-cli/v1',
      delivery: { prompt: 'argument', resultSchema: 'argument', result: 'stdout' },
    },
    bindingToken: bindingToken('codex', 'definition-digest'),
  });
  if (value === undefined) throw new Error('Unable to create prepared launch evidence');
  return value;
};

const startLifecycle = (
  execution: FakeInvocationExecutionPort,
  clock = new FakeInvocationClock({ initialNowMs: 0 }),
) => {
  const settlements: Array<{ readonly status: string }> = [];
  const output = new FakeInvocationOutputPort();
  output.enqueueTerminalResultRecording();
  const prepared = preparedLaunch();
  const lifecycle = new InvocationLifecycle(
    {
      execution,
      clock,
      output,
      outputPreparation: new FakeOutputPreparationPort('prepared'),
      outputClaim: new FakeOutputClaimPort('created'),
      workspace: {
        admit: async () =>
          Object.freeze({ status: 'admitted' as const, directory: '/workspace/project' }),
      },
    },
    snapshot(),
    prepared,
    (settlement) => settlements.push(settlement),
  );
  lifecycle.begin();
  return { lifecycle, settlements, clock, prepared };
};

const bindingToken = (agentId: string, definitionDigest: string): ExecutionBindingToken =>
  ExecutionBindingToken.create({
    agentId,
    agentVersion: '1.0.0',
    definitionDigest,
    protocolDriverId: 'native/stdio-v1',
    resultParserId: 'codex-jsonl/v1',
    permissionStrategyId: 'codex-cli/v1',
    delivery: { prompt: 'argument', resultSchema: 'argument', result: 'stdout' },
  });

const resultSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
};
const resultSchemaValidator = Object.freeze({ validate: () => undefined });

test('passes the identical prepared launch instance to execution', async () => {
  const execution = new FakeInvocationExecutionPort();
  execution.enqueueStart('running');
  const { prepared } = startLifecycle(execution);

  await flush();

  expect(execution.startedPreparedLaunches()).toEqual([prepared]);
  expect(execution.startedPreparedLaunches()[0]).toBe(prepared);
});

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
  expect(settlements).toEqual([{ status: 'failed', reason: 'execution_failed' }]);
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
  execution.settleNaturalCompletion(1, new TextEncoder().encode('{}'));
  await expect(cancellation).rejects.toThrow(
    'Execution completed before cancellation request was accepted',
  );
  await flush();
  expect(settlements).toEqual([{ status: 'succeeded', value: {} }]);
  expect(lifecycle.terminalSettlement()).toEqual({ status: 'succeeded', value: {} });
});

test('moves accepted through starting and running before natural completion', async () => {
  const execution = new FakeInvocationExecutionPort();
  execution.enqueueStart('running');
  const { lifecycle, settlements, clock } = startLifecycle(execution);

  expect(lifecycle.currentState()).toBe('starting');
  await flush();
  expect(lifecycle.currentState()).toBe('running');
  expect(clock.pendingActionCount()).toBe(1);
  execution.settleNaturalCompletion(1, new TextEncoder().encode('{}'));
  await flush();
  expect(settlements).toEqual([{ status: 'succeeded', value: {} }]);
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

  expect(lifecycle.terminalSettlement()).toEqual({ status: 'failed', reason: 'execution_failed' });
  expect(settlements).toEqual([{ status: 'failed', reason: 'execution_failed' }]);
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
  execution.settleNaturalCompletion(1, new TextEncoder().encode('{}'));
  await flush();
  clock.advanceBy(1_000);
  await flush();

  expect(() => execution.settleNaturalCompletion(1)).toThrow('already settled');
  expect(settlements).toEqual([{ status: 'succeeded', value: {} }]);
  expect(lifecycle.terminalSettlement()).toEqual({ status: 'succeeded', value: {} });
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

  expect(settlements).toEqual([{ status: 'failed', reason: 'execution_failed' }]);
  expect(lifecycle.terminalSettlement()).toEqual({ status: 'failed', reason: 'execution_failed' });
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

  expect(settlements).toEqual([{ status: 'failed', reason: 'execution_failed' }]);
  expect(lifecycle.terminalSettlement()).toEqual({ status: 'failed', reason: 'execution_failed' });
});
