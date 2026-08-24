import { expect, test } from 'vitest';

import { createInvocationLifecycleManager } from '../../../src/application/manager/index.js';
import { AgentManagerError } from '../../../src/runtime/errors/index.js';
import { AGENT_FAULT_MESSAGES } from '../../../src/runtime/policy/index.js';
import type { ActiveInvocationSnapshot } from '../../../src/runtime/spec/index.js';
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

const definition = buildAgentDefinition();

const createManager = () =>
  createInvocationLifecycleManager(
    Object.freeze({
      activeStateSink: createTestActiveStateSink(),
      definitions: Object.freeze([definition]),
    }),
    {
      execution: new FakeInvocationExecutionPort(),
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

const snapshot = (invocationId = 'recovered-invocation'): ActiveInvocationSnapshot => ({
  invocationId,
  pin: {
    agentId: definition.id,
    agentVersion: definition.version,
    definitionDigest: 'sha256:definition',
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
  await expect(manager.waitForResult('missing')).resolves.toEqual({ state: 'unknown' });
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
  const operation = createManager().initialize(asSnapshots(new Proxy([snapshot()], {})));

  await expect(operation).rejects.toMatchObject({
    fault: {
      code: 'revo.agent.recovery_failed',
      message: AGENT_FAULT_MESSAGES.recoveryFailed,
      phase: 'initializing',
      retryable: false,
      details: { invocationIds: ['recovered-invocation'] },
    },
  });
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
