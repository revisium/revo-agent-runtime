import { afterEach, expect, test, vi } from 'vitest';

import {
  ExecutionBindingToken,
  InvocationInputSnapshot,
  InvocationLifecycle,
  PreparedLaunch,
} from '../../../../src/runtime/execution/index.js';
import { TerminalPublicationAuthority } from '../../../../src/runtime/execution/output-preparation-attempt/index.js';
import { FakeInvocationClock } from '../../../support/execution/fake-clock.js';
import { FakeInvocationExecutionPort } from '../../../support/execution/fake-execution-port.js';
import { FakeOutputClaimPort } from '../../../support/execution/fake-output-claim-port.js';
import { FakeInvocationOutputPort } from '../../../support/execution/fake-output-port.js';
import { FakeOutputPreparationPort } from '../../../support/execution/fake-output-preparation-port.js';

const authority = TerminalPublicationAuthority.create({
  invocationId: 'lifecycle',
  outputDirectory: '/outputs/invocation',
  invocationToken: {},
});

const flush = async (): Promise<void> => {
  await new Promise<void>((resolve) => setImmediate(resolve));
};

const defaultSpawnedAt = 123_456;

const committedCompletion = (
  outcome: ReturnType<InvocationLifecycle['requestCancellation']>,
): Promise<unknown> => {
  expect(outcome.status).toBe('committed');
  if (outcome.status !== 'committed') throw new Error('Expected committed cancellation.');
  return outcome.completion;
};

const snapshot = (
  limits: Readonly<{ wallClockTimeoutMs: number; idleTimeoutMs: number }> = {
    wallClockTimeoutMs: 1_000,
    idleTimeoutMs: 1_000,
  },
): InvocationInputSnapshot => {
  const value = InvocationInputSnapshot.create({
    invocationId: 'lifecycle',
    agent: { id: 'codex', version: '1.0.0' },
    prompt: 'Return JSON.',
    workspace: { directory: '/workspace/project' },
    parameters: {},
    permissions: {},
    result: { schema: resultSchema },
    output: { directory: '/outputs/invocation' },
    limits,
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
  inputSnapshot = snapshot(),
  hooks: Readonly<{
    removeActiveState?: (invocationId: string) => Promise<void>;
    saveCancellingState?: () => void;
    emitEvent?: (type: 'invocation.started' | 'invocation.cancelling') => void;
  }> = {},
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
    inputSnapshot,
    prepared,
    () => execution.activateQueued(inputSnapshot, prepared),
    authority,
    '2026-08-22T00:00:00.000Z',
    '2026-08-22T00:00:01.000Z',
    hooks.saveCancellingState ?? (() => undefined),
    hooks.removeActiveState ?? (async () => undefined),
    hooks.emitEvent ?? (() => undefined),
    async () => false,
    (settlement) => settlements.push(settlement),
  );
  lifecycle.begin();
  return { lifecycle, settlements, clock, prepared };
};

afterEach(() => {
  vi.restoreAllMocks();
});

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

test('never emits invocation.started when activation throws synchronously', async () => {
  const execution = new FakeInvocationExecutionPort();
  execution.enqueueStart(new Error('activation failed'));
  const events: string[] = [];
  const { settlements } = startLifecycle(execution, undefined, undefined, {
    emitEvent: (type) => events.push(type),
  });
  await flush();

  expect(events).toEqual([]);
  expect(settlements).toMatchObject([{ status: 'failed', error: { code: 'revo.agent.internal' } }]);
});

test('does not emit cancellation after finalization begins', async () => {
  const execution = new FakeInvocationExecutionPort();
  execution.enqueueStart('running');
  const events: string[] = [];
  const { lifecycle } = startLifecycle(execution, undefined, undefined, {
    emitEvent: (type) => events.push(type),
  });

  await flush();
  execution.settleNaturalCompletion(1);
  await flush();

  expect(lifecycle.requestCancellation()).toEqual({ status: 'too_late' });
  expect(events).toEqual(['invocation.started']);
});

test('queues cancellation during a deferred start and cancels exactly once after it runs', async () => {
  const execution = new FakeInvocationExecutionPort();
  execution.enqueuePendingStart();
  const { lifecycle, settlements } = startLifecycle(execution);
  const first = lifecycle.requestCancellation();
  const second = lifecycle.requestCancellation();

  expect(lifecycle.currentState()).toBe('cancelling');
  expect(first.status).toBe('committed');
  expect(second.status).toBe('committed');
  if (first.status !== 'committed' || second.status !== 'committed')
    throw new Error('Expected committed cancellation.');
  expect(second.completion).toBe(first.completion);
  execution.fulfilPendingStart(1);
  await flush();
  expect(execution.calls()).toEqual([
    { type: 'start' },
    { type: 'request-cancellation', executionId: 1 },
  ]);
  execution.settleCancellationRequest(1);
  await expect(committedCompletion(first)).resolves.toBeUndefined();
  execution.confirmCancellation(1);
  await flush();
  expect(settlements).toMatchObject([{ status: 'cancelled' }]);
});

test('settles a deferred start rejection once after queued cancellation', async () => {
  const execution = new FakeInvocationExecutionPort();
  execution.enqueuePendingStart();
  const { lifecycle, settlements } = startLifecycle(execution);
  const cancellation = lifecycle.requestCancellation();
  execution.rejectPendingStart(1, new Error('start failed'));
  await expect(committedCompletion(cancellation)).rejects.toThrow('start failed');
  await flush();
  expect(settlements).toMatchObject([{ status: 'failed' }]);
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
  expect(lifecycle.terminalResult()).toMatchObject({ status: 'timed_out' });
  expect(settlements).toMatchObject([{ status: 'timed_out' }]);
});

test('lets same-turn natural completion win over a rejected pending cancellation request', async () => {
  const execution = new FakeInvocationExecutionPort();
  execution.enqueueStart('running');
  const { lifecycle, settlements } = startLifecycle(execution);
  await flush();
  const cancellation = lifecycle.requestCancellation();
  await flush();
  execution.settleNaturalCompletion(1, new TextEncoder().encode('{}'));
  await expect(committedCompletion(cancellation)).rejects.toThrow(
    'Execution completed before cancellation request was accepted',
  );
  await flush();
  expect(settlements).toMatchObject([{ status: 'succeeded', value: {} }]);
  expect(lifecycle.terminalResult()).toMatchObject({ status: 'succeeded', value: {} });
});

test('moves accepted through starting and running before natural completion', async () => {
  const execution = new FakeInvocationExecutionPort();
  execution.enqueueStart('running');
  const { lifecycle, settlements, clock } = startLifecycle(execution);

  expect(lifecycle.currentState()).toBe('running');
  expect(clock.pendingActionCount()).toBe(2);
  execution.settleNaturalCompletion(1, new TextEncoder().encode('{}'));
  await flush();
  expect(settlements).toMatchObject([{ status: 'succeeded', value: {} }]);
  expect(lifecycle.currentState()).toBe('terminal');
  expect(clock.pendingActionCount()).toBe(0);
});

test('requests deadline cancellation when idle deadline arrives before wall deadline', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(defaultSpawnedAt);
  const execution = new FakeInvocationExecutionPort();
  execution.enqueueStart('running');
  const { clock } = startLifecycle(
    execution,
    new FakeInvocationClock({ initialNowMs: 0 }),
    snapshot({ wallClockTimeoutMs: 2_000, idleTimeoutMs: 1_000 }),
  );
  await flush();

  clock.advanceBy(999);
  await flush();
  expect(execution.calls()).toEqual([{ type: 'start' }]);

  clock.advanceBy(1);
  await flush();
  expect(execution.calls()).toEqual([
    { type: 'start' },
    { type: 'request-cancellation', executionId: 1 },
  ]);
});

test('subtracts elapsed preacceptance time from spawnedAt anchored deadlines', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(defaultSpawnedAt + 700);
  const execution = new FakeInvocationExecutionPort();
  execution.enqueueStart('running');
  const { clock } = startLifecycle(
    execution,
    new FakeInvocationClock({ initialNowMs: 0 }),
    snapshot({ wallClockTimeoutMs: 1_000, idleTimeoutMs: 1_000 }),
  );
  await flush();

  clock.advanceBy(299);
  await flush();
  expect(execution.calls()).toEqual([{ type: 'start' }]);

  clock.advanceBy(1);
  await flush();
  expect(execution.calls()).toEqual([
    { type: 'start' },
    { type: 'request-cancellation', executionId: 1 },
  ]);
});

test('disarms both wall and idle deadline schedules after natural completion', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(defaultSpawnedAt);
  const execution = new FakeInvocationExecutionPort();
  execution.enqueueStart('running');
  const { settlements, clock } = startLifecycle(execution);
  await flush();

  expect(clock.pendingActionCount()).toBe(2);
  execution.settleNaturalCompletion(1, new TextEncoder().encode('{}'));
  await flush();

  expect(settlements).toMatchObject([{ status: 'succeeded', value: {} }]);
  expect(clock.pendingActionCount()).toBe(0);
});

test('keeps caller-confirmed cancellation classified as cancelled after deadline polarity change', async () => {
  const execution = new FakeInvocationExecutionPort();
  execution.enqueueStart('running');
  const { lifecycle, settlements } = startLifecycle(execution);
  await flush();

  const cancellation = lifecycle.requestCancellation();
  await flush();
  execution.settleCancellationRequest(1);
  await expect(committedCompletion(cancellation)).resolves.toBeUndefined();
  execution.confirmCancellation(1);
  await flush();

  expect(settlements).toMatchObject([{ status: 'cancelled' }]);
});

test('commits failed once when execution completion rejects', async () => {
  const execution = new FakeInvocationExecutionPort();
  execution.enqueueStart('running');
  const { lifecycle, settlements } = startLifecycle(execution);
  await flush();
  execution.settleCompletionFailure(1, new Error('completion failed'));
  await flush();

  expect(lifecycle.terminalResult()).toMatchObject({ status: 'failed' });
  expect(settlements).toMatchObject([{ status: 'failed' }]);
});

test('keeps fulfilled caller cancellation nonterminal until execution confirms it', async () => {
  const execution = new FakeInvocationExecutionPort();
  execution.enqueueStart('running');
  const { lifecycle, settlements } = startLifecycle(execution);
  await flush();
  const cancellation = lifecycle.requestCancellation();
  await flush();
  execution.settleCancellationRequest(1);
  await expect(committedCompletion(cancellation)).resolves.toBeUndefined();
  expect(settlements).toEqual([]);
  expect(lifecycle.currentState()).toBe('cancelling');
  execution.confirmCancellation(1);
  await flush();
  expect(settlements).toMatchObject([{ status: 'cancelled' }]);
});

test('removes active state before terminal result publication', async () => {
  const execution = new FakeInvocationExecutionPort();
  execution.enqueueStart('running');
  let releaseRemove: (() => void) | undefined;
  const remove = new Promise<void>((resolve) => {
    releaseRemove = resolve;
  });
  const { lifecycle, settlements } = startLifecycle(
    execution,
    new FakeInvocationClock({ initialNowMs: 0 }),
    snapshot(),
    { removeActiveState: async () => remove },
  );

  execution.settleNaturalCompletion(1, new TextEncoder().encode('{}'));
  await flush();
  expect(lifecycle.currentState()).toBe('finalizing');
  expect(settlements).toEqual([]);

  releaseRemove?.();
  await flush();
  expect(settlements).toMatchObject([{ status: 'succeeded' }]);
});

test.each([
  ['confirmed cleanup', undefined, 1],
  [
    'failed cleanup',
    Object.freeze({
      cause: 'termination_rejected' as const,
      termSent: false,
      killSent: false,
      lastKnownGroupState: 'unknown' as const,
      leaderReapState: 'unknown' as const,
    }),
    0,
  ],
] as const)('gates active-state removal on %s', async (_name, cleanupOutcome, expectedRemoves) => {
  const execution = new FakeInvocationExecutionPort();
  execution.enqueueStart('running');
  const removeActiveState = vi.fn(async (): Promise<void> => undefined);
  const { lifecycle } = startLifecycle(
    execution,
    new FakeInvocationClock({ initialNowMs: 0 }),
    snapshot(),
    { removeActiveState },
  );

  lifecycle.requestCancellation();
  await flush();
  execution.settleCancellationRequest(1, cleanupOutcome);
  execution.confirmCancellation(1);
  await flush();

  expect(removeActiveState).toHaveBeenCalledTimes(expectedRemoves);
});

test('attempts cancelling-state save before cleanup without waiting for it', async () => {
  const execution = new FakeInvocationExecutionPort();
  execution.enqueueStart('running');
  const calls: string[] = [];
  const { lifecycle } = startLifecycle(
    execution,
    new FakeInvocationClock({ initialNowMs: 0 }),
    snapshot(),
    {
      saveCancellingState: () => {
        calls.push('save-cancelling');
      },
    },
  );

  lifecycle.requestCancellation();
  await flush();

  expect(calls).toEqual(['save-cancelling']);
  expect(execution.calls()).toContainEqual({ type: 'request-cancellation', executionId: 1 });
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
  expect(settlements).toMatchObject([{ status: 'succeeded', value: {} }]);
  expect(lifecycle.terminalResult()).toMatchObject({ status: 'succeeded', value: {} });
});

test('lets completion failure win while caller cancellation is pending', async () => {
  const execution = new FakeInvocationExecutionPort();
  execution.enqueueStart('running');
  const { lifecycle, settlements } = startLifecycle(execution);
  await flush();
  const cancellation = lifecycle.requestCancellation();
  await flush();
  execution.settleCompletionFailure(1, new Error('completion failure'));
  await expect(committedCompletion(cancellation)).rejects.toThrow('completion failure');
  await flush();

  expect(settlements).toMatchObject([{ status: 'failed' }]);
  expect(lifecycle.terminalResult()).toMatchObject({ status: 'failed' });
});

test('settles a standalone rejected cancellation request as failed after microtask arbitration', async () => {
  const execution = new FakeInvocationExecutionPort();
  execution.enqueueStart('running');
  const { lifecycle, settlements } = startLifecycle(execution);
  await flush();
  const cancellation = lifecycle.requestCancellation();
  await flush();
  execution.rejectCancellationRequest(1, new Error('cancellation rejected'));
  await expect(committedCompletion(cancellation)).rejects.toThrow('cancellation rejected');
  await flush();

  expect(settlements).toMatchObject([{ status: 'failed' }]);
  expect(lifecycle.terminalResult()).toMatchObject({ status: 'failed' });
});
