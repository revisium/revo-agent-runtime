import { expect, test, vi } from 'vitest';

import { createInvocationLifecycleManager } from '../../../src/application/manager/index.js';
import { validateManagerOptions } from '../../../src/runtime/definition/index.js';
import { AgentManagerError } from '../../../src/runtime/errors/index.js';
import type { InvocationExecutionPorts } from '../../../src/runtime/execution/index.js';
import { AGENT_FAULT_MESSAGES } from '../../../src/runtime/policy/index.js';
import type { ActiveInvocationSnapshot } from '../../../src/runtime/spec/index.js';
import {
  buildAgentDefinition,
  createRecordingActiveStateSink,
  createTestActiveStateSink,
} from '../../support/definition/build-agent-definition.js';
import { FakeInvocationClock } from '../../support/execution/fake-clock.js';
import { FakeInvocationExecutionPort } from '../../support/execution/fake-execution-port.js';
import { FakeOutputClaimPort } from '../../support/execution/fake-output-claim-port.js';
import { FakeInvocationOutputPort } from '../../support/execution/fake-output-port.js';
import { FakeOutputPreparationPort } from '../../support/execution/fake-output-preparation-port.js';
import { FreshAvailableExecutableProbePort } from '../../support/probe/fresh-available-executable-probe-port.js';

const definition = buildAgentDefinition();

const validatedDefinition = validateManagerOptions({
  activeStateSink: createTestActiveStateSink(),
  definitions: [definition],
}).definitions[0];
if (validatedDefinition === undefined) throw new Error('Expected validated definition');

const createManager = (
  execution: InvocationExecutionPorts['execution'] = new FakeInvocationExecutionPort(),
  activeStateSink = createTestActiveStateSink(),
  limits?: Readonly<{
    initializationTimeoutMs?: number;
    activeStateOperationTimeoutMs?: number;
  }>,
) =>
  createInvocationLifecycleManager(
    Object.freeze({
      activeStateSink,
      definitions: Object.freeze([definition]),
      ...(limits === undefined ? {} : { limits }),
    }),
    {
      execution,
      clock: new FakeInvocationClock({ initialNowMs: 0 }),
      output: new FakeInvocationOutputPort(),
      outputClaim: new FakeOutputClaimPort('created'),
      outputPreparation: new FakeOutputPreparationPort('prepared'),
      executableProbe: new FreshAvailableExecutableProbePort('/resolved/fixture-agent', '1.0.0'),
      workspace: {
        admit: async () => ({ status: 'admitted' as const, directory: '/workspace/project' }),
      },
    },
  );

const snapshot = (
  invocationId = 'recovered-invocation',
  overrides: Partial<ActiveInvocationSnapshot['pin']> = {},
): ActiveInvocationSnapshot => ({
  invocationId,
  pin: {
    agentId: definition.id,
    agentVersion: definition.version,
    definitionDigest: validatedDefinition.definitionDigest,
    ...overrides,
  },
  state: 'running',
  process: {
    pid: 123,
    processGroupId: 123,
    fingerprint: 'sha256:process',
    startedAt: '2026-08-24T00:00:00.000Z',
  },
});

const asSnapshots = (value: unknown): readonly ActiveInvocationSnapshot[] => {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return value as readonly ActiveInvocationSnapshot[];
};

const expectFault = async (
  operation: Promise<unknown>,
  expected: Readonly<Record<string, unknown>>,
): Promise<void> => {
  await expect(operation).rejects.toBeInstanceOf(AgentManagerError);
  try {
    await operation;
  } catch (error: unknown) {
    if (error instanceof AgentManagerError) expect(error.fault).toEqual(expected);
  }
};

const recoveryInvalidFault = {
  code: 'revo.agent.recovery_invalid',
  message: AGENT_FAULT_MESSAGES.recoveryInvalid,
  phase: 'initializing',
  retryable: false,
};

test('initialization is a shared asynchronous readiness barrier', async () => {
  const manager = createManager();
  const first = manager.initialize([]);
  const second = manager.initialize(asSnapshots([snapshot()]));

  expect(first).toBeInstanceOf(Promise);
  expect(second).toBe(first);
  expect(() => manager.getResult('before-ready')).toThrowError(AgentManagerError);
  await first;
  expect(manager.getResult('after-ready')).toEqual({ state: 'unknown' });
});

test('shutdown wins over the not-initialized start gate', async () => {
  const manager = createManager();
  await manager.shutdown();

  await expect(manager.start(null)).resolves.toEqual({
    status: 'rejected',
    reason: 'manager_closed',
  });
});

test('waitForResult throws synchronously before initialization', () => {
  const manager = createManager();

  expect(() => manager.waitForResult('before-ready')).toThrowError(AgentManagerError);
  try {
    void manager.waitForResult('before-ready');
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(AgentManagerError);
    if (error instanceof AgentManagerError)
      expect(error.fault.code).toBe('revo.agent.manager_not_initialized');
  }
});

test('failed initialization permanently closes gated operations', async () => {
  const manager = createManager();
  await expectFault(manager.initialize(asSnapshots({})), recoveryInvalidFault);

  expect(() => manager.getResult('failed')).toThrowError(AgentManagerError);
  expect(() => manager.subscribe({}, () => undefined)).toThrowError(AgentManagerError);
  await expect(manager.start({})).resolves.toEqual({
    status: 'rejected',
    reason: 'manager_closed',
  });
});

test('keeps process-local reads available after shutdown', async () => {
  const manager = createManager();
  await manager.initialize([]);
  await manager.shutdown();

  expect(manager.getResult('missing')).toEqual({ state: 'unknown' });
  expect(manager.getInvocation('missing')).toBeUndefined();
  expect(manager.listInvocations()).toEqual([]);
  await expect(manager.waitForResult('missing')).rejects.toMatchObject({
    fault: { code: 'revo.agent.invocation_unknown' },
  });
  await expect(manager.cancel('missing')).resolves.toEqual({ state: 'unknown' });
});

test('rejects hostile outer snapshot containers before recovery work', async () => {
  const customPrototype = [snapshot()];
  Object.setPrototypeOf(customPrototype, null);
  const sparse = new Array<ActiveInvocationSnapshot>(1);
  const trapped = new Proxy<ActiveInvocationSnapshot[]>([], {
    ownKeys: () => {
      throw new Error('snapshot-inspection-trap');
    },
  });

  await Promise.all(
    [customPrototype, sparse, trapped].map((value) =>
      expectFault(createManager().initialize(asSnapshots(value)), recoveryInvalidFault),
    ),
  );
});

test('accepts a transparent snapshot proxy through structural validation', async () => {
  const operation = createManager().initialize(
    asSnapshots(
      new Proxy([snapshot('recovered-invocation', { definitionDigest: 'sha256:definition' })], {}),
    ),
  );

  await expect(operation).rejects.toMatchObject({
    fault: {
      code: 'revo.agent.recovery_failed',
      message: AGENT_FAULT_MESSAGES.recoveryFailed,
      phase: 'initializing',
      retryable: false,
      details: {
        failures: [{ invocationId: 'recovered-invocation', category: 'pin_digest_mismatch' }],
      },
    },
  });
});

test('removes rows reported absent and terminated', async () => {
  const execution = new FakeInvocationExecutionPort();
  execution.enqueueRecoveryResult({ status: 'absent' });
  execution.enqueueRecoveryResult({ status: 'terminated' });
  const sink = createRecordingActiveStateSink();
  const manager = createManager(execution, sink);

  await manager.initialize(asSnapshots([snapshot('b'), snapshot('a')]));

  expect(sink.calls).toEqual(['a', 'b']);
  expect(execution.recoveryCalls().map((call) => call.pid)).toEqual([123, 123]);
});

test('preserves identity mismatches without removing them', async () => {
  const execution = new FakeInvocationExecutionPort();
  execution.enqueueRecoveryResult({ status: 'identity_mismatch' });
  const sink = createRecordingActiveStateSink();
  const manager = createManager(execution, sink);

  await expect(manager.initialize(asSnapshots([snapshot()]))).rejects.toMatchObject({
    fault: { details: { failures: [{ category: 'identity_conflict' }] } },
  });
  expect(sink.calls).toEqual([]);
});

test('rejects shutdown after recovery reports uncertain cleanup', async () => {
  const execution = new FakeInvocationExecutionPort();
  execution.enqueueRecoveryResult({ status: 'termination_unconfirmed', cause: 'group_still_live' });
  const manager = createManager(execution);

  await expect(
    manager.initialize(asSnapshots([snapshot('uncertain-recovery')])),
  ).rejects.toMatchObject({
    fault: {
      code: 'revo.agent.recovery_failed',
      details: {
        failures: [{ invocationId: 'uncertain-recovery', category: 'termination_unconfirmed' }],
      },
    },
  });
  await expect(manager.shutdown()).rejects.toMatchObject({
    fault: {
      code: 'revo.agent.shutdown_failed',
      details: { invocationId: 'uncertain-recovery', failureCount: 1 },
    },
  });
});

test('retains uncertain cleanup discovered before a mid-batch shutdown', async () => {
  const execution = new FakeInvocationExecutionPort();
  execution.enqueueRecoveryResult({ status: 'termination_unconfirmed', cause: 'group_still_live' });
  execution.enqueueRecoveryResult({ status: 'absent' });
  const sink = createRecordingActiveStateSink();
  let manager: ReturnType<typeof createManager>;
  let shutdown: Promise<void> | undefined;
  manager = createManager(execution, sink);
  const original = execution.inspectAndReconcileRecoveredProcess.bind(execution);
  let first = true;
  execution.inspectAndReconcileRecoveredProcess = async (...args) => {
    const result = await original(...args);
    if (first) {
      first = false;
      shutdown = manager.shutdown();
    }
    return result;
  };

  await expect(
    manager.initialize(asSnapshots([snapshot('a'), snapshot('b')])),
  ).rejects.toMatchObject({
    fault: {
      details: {
        failures: [
          { invocationId: 'a', category: 'termination_unconfirmed' },
          { invocationId: 'b', category: 'manager_closing' },
        ],
      },
    },
  });
  if (shutdown === undefined) throw new Error('Expected shutdown to be started.');
  await expect(shutdown).rejects.toMatchObject({
    fault: { code: 'revo.agent.shutdown_failed', details: { failureCount: 1 } },
  });
  expect(sink.calls).toEqual([]);
});

test('retains uncertain cleanup evidence when a later recovery row hangs', async () => {
  let secondRowStarted: (() => void) | undefined;
  const secondRowStartedPromise = new Promise<void>((resolve) => {
    secondRowStarted = resolve;
  });
  let calls = 0;
  const execution: InvocationExecutionPorts['execution'] = {
    inspectAndReconcileRecoveredProcess: async () => {
      calls += 1;
      if (calls === 1)
        return { status: 'termination_unconfirmed' as const, cause: 'group_still_live' as const };
      secondRowStarted?.();
      return await new Promise<
        Awaited<
          ReturnType<InvocationExecutionPorts['execution']['inspectAndReconcileRecoveredProcess']>
        >
      >(() => undefined);
    },
    spawnAndIdentify: async () => ({ status: 'failed', reason: 'spawn_failed' as const }),
  };
  const manager = createManager(execution, createTestActiveStateSink(), {
    initializationTimeoutMs: 1_000,
    activeStateOperationTimeoutMs: 1_000,
  });
  const initialization = manager.initialize(asSnapshots([snapshot('a'), snapshot('b')]));
  await secondRowStartedPromise;

  await expect(manager.shutdown()).rejects.toMatchObject({
    fault: {
      code: 'revo.agent.shutdown_failed',
      details: { invocationId: 'a', failureCount: 2 },
    },
  });
  expect(initialization).toBeInstanceOf(Promise);
});

test('reports unknown pins without inspecting the process', async () => {
  const execution = new FakeInvocationExecutionPort();
  const manager = createManager(execution);

  await expect(
    manager.initialize(asSnapshots([snapshot('unknown-pin', { agentId: 'missing-agent' })])),
  ).rejects.toMatchObject({
    fault: { details: { failures: [{ category: 'pin_unknown' }] } },
  });
  expect(execution.recoveryCalls()).toEqual([]);
});

test('reports digest mismatches without inspecting the process', async () => {
  const execution = new FakeInvocationExecutionPort();
  const manager = createManager(execution);

  await expect(
    manager.initialize(
      asSnapshots([snapshot('wrong-digest', { definitionDigest: 'sha256:wrong' })]),
    ),
  ).rejects.toMatchObject({
    fault: { details: { failures: [{ category: 'pin_digest_mismatch' }] } },
  });
  expect(execution.recoveryCalls()).toEqual([]);
});

test('rejects over-bound recovery identifiers before any recovery side effect', async () => {
  for (const row of [
    snapshot('i'.repeat(257)),
    snapshot('over-bound-agent', { agentId: 'a'.repeat(257) }),
  ]) {
    const execution = new FakeInvocationExecutionPort();
    const sink = createRecordingActiveStateSink();
    const manager = createManager(execution, sink);

    // oxlint-disable-next-line no-await-in-loop -- each manager owns an isolated rejection assertion.
    await expect(manager.initialize(asSnapshots([row]))).rejects.toMatchObject({
      fault: { code: 'revo.agent.recovery_invalid' },
    });
    expect(execution.recoveryCalls()).toEqual([]);
    expect(sink.calls).toEqual([]);
  }
});

test('bounds recovery failure details and marks truncation', async () => {
  const execution = new FakeInvocationExecutionPort();
  const unknownAgentId = 'u'.repeat(256);
  const rows = Array.from({ length: 1_000 }, (_, index) =>
    snapshot(`${String(index).padStart(4, '0')}-${'i'.repeat(251)}`, {
      agentId: unknownAgentId,
    }),
  );
  const manager = createManager(execution);

  await expect(manager.initialize(asSnapshots(rows))).rejects.toMatchObject({
    fault: { code: 'revo.agent.recovery_failed' },
  });
  try {
    await manager.initialize(asSnapshots(rows));
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(AgentManagerError);
    if (!(error instanceof AgentManagerError)) return;
    const details = error.fault.details;
    expect(details).toBeDefined();
    if (details === undefined) return;
    expect(details.truncated).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(details)).byteLength).toBeLessThanOrEqual(
      65_536,
    );
  }
});

test('keeps every small recovery failure in invocation order without truncation', async () => {
  const execution = new FakeInvocationExecutionPort();
  const manager = createManager(execution);

  await expect(
    manager.initialize(
      asSnapshots([
        snapshot('b-small', { agentId: 'missing-b' }),
        snapshot('a-small', { agentId: 'missing-a' }),
      ]),
    ),
  ).rejects.toMatchObject({
    fault: {
      details: {
        failures: [
          { invocationId: 'a-small', category: 'pin_unknown' },
          { invocationId: 'b-small', category: 'pin_unknown' },
        ],
        truncated: false,
      },
    },
  });
});

test('does not leak rejected recovery-port error details into public failures', async () => {
  const execution = new FakeInvocationExecutionPort();
  execution.enqueueRecoveryRejection(new Error('/sensitive/private/path SUPERSECRETVALUE'));
  const manager = createManager(execution);

  try {
    await manager.initialize(asSnapshots([snapshot('port-rejected')]));
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(AgentManagerError);
    if (!(error instanceof AgentManagerError)) return;
    const details = error.fault.details;
    expect(details).toBeDefined();
    if (details === undefined) return;
    const failuresValue: unknown = details.failures;
    expect(Array.isArray(failuresValue)).toBe(true);
    if (!Array.isArray(failuresValue)) return;
    const failure: unknown = failuresValue[0];
    expect(failure).toBeDefined();
    if (failure === undefined || typeof failure !== 'object' || failure === null) return;
    expect(Reflect.ownKeys(failure)).toEqual(['invocationId', 'category']);
    expect(JSON.stringify(details)).not.toContain('/sensitive/private/path');
    expect(JSON.stringify(details)).not.toContain('SUPERSECRETVALUE');
  }
});

test('copies recovery rows synchronously before the caller can mutate them', async () => {
  const execution = new FakeInvocationExecutionPort();
  execution.enqueueRecoveryResult({ status: 'absent' });
  const sink = createRecordingActiveStateSink();
  const manager = createManager(execution, sink);
  const original = snapshot('synchronous-copy');
  const row = {
    ...original,
    pin: { ...original.pin },
    process: { ...original.process },
  };
  const rows = [row];

  const initialization = manager.initialize(asSnapshots(rows));
  row.pin.agentId = 'mutated-agent';
  row.process.pid = 999_999;
  await initialization;

  expect(execution.recoveryCalls()[0]?.pid).toBe(123);
  expect(sink.calls).toEqual(['synchronous-copy']);
});

test('marks rows deadline_exceeded before dispatching a later port call', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  try {
    const execution = new FakeInvocationExecutionPort();
    execution.enqueueRecoveryResult({ status: 'inconclusive' });
    const manager = createManager(execution, createTestActiveStateSink(), {
      initializationTimeoutMs: 1_000,
      activeStateOperationTimeoutMs: 1_000,
    });
    const original = execution.inspectAndReconcileRecoveredProcess.bind(execution);
    execution.inspectAndReconcileRecoveredProcess = async (...args) => {
      const result = await original(...args);
      vi.setSystemTime(2_000);
      return result;
    };

    await expect(
      manager.initialize(asSnapshots([snapshot('a'), snapshot('b')])),
    ).rejects.toMatchObject({
      fault: {
        details: {
          failures: [
            { invocationId: 'a', category: 'inspection_inconclusive' },
            { invocationId: 'b', category: 'deadline_exceeded' },
          ],
        },
      },
    });
    expect(execution.recoveryCalls()).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
});

test('does not dispatch remove after the port consumes the initialization deadline', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  try {
    const execution = new FakeInvocationExecutionPort();
    execution.enqueueRecoveryResult({ status: 'absent' });
    const sink = createRecordingActiveStateSink();
    const manager = createManager(execution, sink, {
      initializationTimeoutMs: 1_000,
      activeStateOperationTimeoutMs: 1_000,
    });
    const original = execution.inspectAndReconcileRecoveredProcess.bind(execution);
    execution.inspectAndReconcileRecoveredProcess = async (...args) => {
      const result = await original(...args);
      vi.setSystemTime(2_000);
      return result;
    };

    await expect(manager.initialize(asSnapshots([snapshot()]))).rejects.toMatchObject({
      fault: { details: { failures: [{ category: 'deadline_exceeded' }] } },
    });
    expect(sink.calls).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});

test('marks remaining rows manager_closing when shutdown starts mid-batch', async () => {
  const execution = new FakeInvocationExecutionPort();
  execution.enqueueRecoveryResult({ status: 'absent' });
  execution.enqueueRecoveryResult({ status: 'absent' });
  const sink = createRecordingActiveStateSink();
  let manager: ReturnType<typeof createManager>;
  manager = createManager(execution, sink);
  const original = execution.inspectAndReconcileRecoveredProcess.bind(execution);
  let first = true;
  execution.inspectAndReconcileRecoveredProcess = async (...args) => {
    const result = await original(...args);
    if (first) {
      first = false;
      void manager.shutdown();
    }
    return result;
  };

  await expect(
    manager.initialize(asSnapshots([snapshot('a'), snapshot('b')])),
  ).rejects.toMatchObject({
    fault: {
      details: {
        failures: [{ invocationId: 'b', category: 'manager_closing' }],
      },
    },
  });
  expect(execution.recoveryCalls()).toHaveLength(1);
  expect(sink.calls).toEqual(['a']);
  await expect(manager.shutdown()).resolves.toBeUndefined();
});

test('continues mixed recovery in invocation order and preserves ordered failures', async () => {
  const execution = new FakeInvocationExecutionPort();
  execution.enqueueRecoveryResult({ status: 'absent' });
  execution.enqueueRecoveryResult({ status: 'identity_mismatch' });
  execution.enqueueRecoveryResult({ status: 'terminated' });
  const sink = createRecordingActiveStateSink();
  const manager = createManager(execution, sink);

  await expect(
    manager.initialize(asSnapshots([snapshot('c'), snapshot('a'), snapshot('b')])),
  ).rejects.toMatchObject({
    fault: {
      details: {
        failures: [{ invocationId: 'b', category: 'identity_conflict' }],
      },
    },
  });
  expect(execution.recoveryCalls().map((call) => call.pid)).toEqual([123, 123, 123]);
  expect(sink.calls).toEqual(['a', 'c']);
});

test('preserves every row without inspection or sink mutation on unsupported platforms', async () => {
  const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
  try {
    const execution = new FakeInvocationExecutionPort();
    const sink = createRecordingActiveStateSink();
    const manager = createManager(execution, sink);

    await expect(
      manager.initialize(asSnapshots([snapshot('b'), snapshot('a')])),
    ).rejects.toMatchObject({
      fault: {
        details: {
          failures: [
            { invocationId: 'a', category: 'platform_unsupported' },
            { invocationId: 'b', category: 'platform_unsupported' },
          ],
        },
      },
    });
    expect(execution.recoveryCalls()).toEqual([]);
    expect(sink.calls).toEqual([]);
  } finally {
    platform.mockRestore();
  }
});

test('shutdown resolves after an ordinary rejected initialization', async () => {
  const manager = createManager();
  await expect(manager.initialize(asSnapshots({}))).rejects.toMatchObject({
    fault: { code: 'revo.agent.recovery_invalid' },
  });

  await expect(manager.shutdown()).resolves.toBeUndefined();
});

test('shutdown reports recovery incomplete when the current recovery operation hangs', async () => {
  let inspectionStarted: (() => void) | undefined;
  const inspectionStartedPromise = new Promise<void>((resolve) => {
    inspectionStarted = resolve;
  });
  const execution: InvocationExecutionPorts['execution'] = {
    inspectAndReconcileRecoveredProcess: async () => {
      inspectionStarted?.();
      return await new Promise(() => undefined);
    },
    spawnAndIdentify: async () => ({ status: 'failed', reason: 'spawn_failed' as const }),
  };
  const manager = createManager(execution, createTestActiveStateSink(), {
    initializationTimeoutMs: 1_000,
    activeStateOperationTimeoutMs: 1_000,
  });
  const initialization = manager.initialize(asSnapshots([snapshot()]));
  await inspectionStartedPromise;
  const shutdown = manager.shutdown();

  await expect(shutdown).rejects.toMatchObject({
    fault: {
      code: 'revo.agent.shutdown_failed',
      details: { failureCount: 1 },
    },
  });
  expect(
    await Promise.race([initialization.then(() => 'settled'), Promise.resolve('pending')]),
  ).toBe('pending');
});

test('validates every row before reporting malformed recovery input', async () => {
  const malformed = snapshot('malformed');
  Reflect.deleteProperty(malformed, 'process');

  await expectFault(
    createManager().initialize(asSnapshots([snapshot('valid'), malformed])),
    recoveryInvalidFault,
  );
  await expectFault(
    createManager().initialize(asSnapshots([snapshot('duplicate'), snapshot('duplicate')])),
    recoveryInvalidFault,
  );
});

test('enforces the active snapshot limit for dense and sparse batches', async () => {
  const dense = Array.from({ length: 1_001 }, (_, index) => snapshot(`dense-${index}`));
  const sparse = new Array<ActiveInvocationSnapshot>(1_001);
  const expected = {
    code: 'revo.agent.limit_invalid',
    message: AGENT_FAULT_MESSAGES.limitInvalid,
    phase: 'initializing',
    retryable: false,
    details: { operation: 'initialize', limit: 1_000 },
  };

  await expectFault(createManager().initialize(asSnapshots(dense)), expected);
  await expectFault(createManager().initialize(asSnapshots(sparse)), expected);
});
