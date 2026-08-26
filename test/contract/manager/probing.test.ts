import { expect, test } from 'vitest';

import * as managerModule from '../../../src/application/manager/index.js';
import { AgentManagerError } from '../../../src/runtime/errors/index.js';
import { AGENT_FAULT_MESSAGES } from '../../../src/runtime/policy/index.js';
import type { AgentDefinitionInput, AgentRef } from '../../../src/runtime/spec/index.js';
import { buildAgentDefinition } from '../../support/definition/build-agent-definition.js';
import {
  createInitializedProbeCapableManager,
  createProbeCapableManager,
} from '../../support/manager/create-probe-capable-manager.js';
import { FakeExecutableProbePort } from '../../support/probe/fake-executable-probe-port.js';

const flushMicrotasks = async (remaining = 12): Promise<void> => {
  if (remaining === 0) return;
  await Promise.resolve();
  await flushMicrotasks(remaining - 1);
};

const reference = (id: string, version = '1.0.0'): AgentRef => ({ id, version });

const requiredVersionProbe = (id: string, version = '1.0.0'): AgentDefinitionInput =>
  buildAgentDefinition({
    id,
    version,
    displayName: id,
    launch: { ...buildAgentDefinition().launch, command: `/fixture/bin/${id}` },
    constraints: { platforms: ['linux'] },
  });

const withVersionProbe = (id: string, version = '1.0.0'): AgentDefinitionInput =>
  buildAgentDefinition({
    id,
    version,
    displayName: id,
    launch: { ...buildAgentDefinition().launch, command: `/fixture/bin/${id}` },
  });

const managerWithDefinitions = async (definitions: readonly AgentDefinitionInput[]) =>
  createInitializedProbeCapableManager(definitions);

const exited = () => ({
  status: 'exited' as const,
  exitCode: 0,
  signal: null,
  stdout: new TextEncoder().encode('agent 1.0.0\n'),
  stderr: new Uint8Array(),
  overflow: 'none' as const,
});

const expectFault = async (
  operation: Promise<unknown>,
  expected: Readonly<Record<string, unknown>>,
  rawMarker?: string,
): Promise<void> => {
  try {
    await operation;
    throw new Error('Expected operation to reject');
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(AgentManagerError);
    if (!(error instanceof AgentManagerError)) return;

    expect(error.fault).toEqual(expected);
    if (rawMarker !== undefined) expect(error.message).not.toContain(rawMarker);
  }
};

const unknownFault = (details: Record<string, string | number>) => ({
  code: 'revo.agent.agent_unknown',
  message: AGENT_FAULT_MESSAGES.agentUnknown,
  phase: 'probing',
  retryable: false,
  details,
});

const internalProbeFault = {
  code: 'revo.agent.internal',
  message: AGENT_FAULT_MESSAGES.internalProbe,
  phase: 'probing',
  retryable: false,
};

const expectPortUnobserved = (port: FakeExecutableProbePort): void => {
  expect(port.calls()).toEqual([]);
  expect(port.hostPlatformReadCount()).toBe(0);
};

test('renames the internal discovery factory without retaining an alias', () => {
  expect(managerModule).not.toHaveProperty('createProbeableAgentDiscovery');
  expect(managerModule).not.toHaveProperty('createAgentDiscovery');
});

test('probes one exact agent through a new admitted physical operation', async () => {
  const { manager, port } = await managerWithDefinitions([requiredVersionProbe('a')]);
  port.enqueueResolution({ status: 'resolved', executable: '/resolved/a' });
  port.enqueueVersionStart(exited());

  const result = await manager.probeAgent(reference('a'));

  expect(result).toMatchObject({
    status: 'available',
    agent: reference('a'),
    executable: '/resolved/a',
  });
  expect(port.calls()).toEqual([
    { type: 'resolve', command: '/fixture/bin/a' },
    expect.objectContaining({ type: 'start-version', executable: '/resolved/a' }),
  ]);
  expect(Object.isFrozen(result)).toBe(true);
});

test('propagates the evaluator-owned internal fault through one probe without raw error text', async () => {
  const { manager, port } = await managerWithDefinitions([requiredVersionProbe('a')]);
  port.enqueueResolution(new Error('single raw port failure'));

  const operation = manager.probeAgent(reference('a'));
  expect(operation).toBeInstanceOf(Promise);
  await expectFault(operation, internalProbeFault, 'single raw port failure');
});

test('rejects malformed and unknown single references asynchronously before port observation', async () => {
  const { manager, port } = await managerWithDefinitions([requiredVersionProbe('a')]);

  const malformedReference = reference('a');
  Reflect.deleteProperty(malformedReference, 'version');
  const malformed = manager.probeAgent(malformedReference);
  expect(malformed).toBeInstanceOf(Promise);
  await expectFault(malformed, unknownFault({ operation: 'probeAgent' }));
  await expectFault(
    manager.probeAgent(reference('missing')),
    unknownFault({ operation: 'probeAgent' }),
  );

  expectPortUnobserved(port);
});

test('rejects malformed outer batch containers before registry or port observation', async () => {
  const { manager, port } = await managerWithDefinitions([requiredVersionProbe('a')]);
  const customPrototype: AgentRef[] = [reference('a')];
  Object.setPrototypeOf(customPrototype, null);
  const sparse = new Array<AgentRef>(1);
  const trapped = new Proxy<AgentRef[]>([], {
    ownKeys: () => {
      throw new Error('outer-inspection-trap');
    },
  });
  const operations = [customPrototype, sparse, trapped].map((refs) => manager.probeAgents(refs));

  for (const operation of operations) expect(operation).toBeInstanceOf(Promise);
  await Promise.all(
    operations.map((operation) =>
      expectFault(operation, unknownFault({ operation: 'probeAgents' }), 'outer-inspection-trap'),
    ),
  );

  expectPortUnobserved(port);
});

test('accepts a transparent array proxy when its observable shape is ordinary', async () => {
  const { manager, port } = await managerWithDefinitions([requiredVersionProbe('a')]);
  port.enqueueResolution({ status: 'resolved', executable: '/resolved/a' });
  port.enqueueVersionStart(exited());

  const result = await manager.probeAgents(new Proxy([reference('a')], {}));

  expect(result).toHaveLength(1);
  expect(port.calls()).toEqual([
    { type: 'resolve', command: '/fixture/bin/a' },
    expect.objectContaining({ type: 'start-version', executable: '/resolved/a' }),
  ]);
});

test('prevalidates every batch input in order before it admits physical work', async () => {
  const { manager, port } = await managerWithDefinitions([requiredVersionProbe('a')]);
  const malformedReference = reference('bad');
  Reflect.deleteProperty(malformedReference, 'version');

  await expectFault(
    manager.probeAgents([reference('a'), malformedReference, reference('missing')]),
    unknownFault({ operation: 'probeAgents', index: 1 }),
  );
  await expectFault(
    manager.probeAgents([reference('a'), reference('missing'), malformedReference]),
    unknownFault({ operation: 'probeAgents', index: 1 }),
  );

  expectPortUnobserved(port);
});

test('bounds batch length before effects and permits exactly one thousand duplicate refs', async () => {
  const { manager, port } = await managerWithDefinitions([requiredVersionProbe('a')]);
  const tooMany = Array.from({ length: 1_001 }, () => reference('a'));
  const sparseTooMany = new Array<AgentRef>(1_001);

  await expectFault(manager.probeAgents(tooMany), {
    code: 'revo.agent.limit_invalid',
    message: AGENT_FAULT_MESSAGES.limitInvalid,
    phase: 'probing',
    retryable: false,
    details: { operation: 'probeAgents', limit: 1_000 },
  });
  await expectFault(manager.probeAgents(sparseTooMany), {
    code: 'revo.agent.limit_invalid',
    message: AGENT_FAULT_MESSAGES.limitInvalid,
    phase: 'probing',
    retryable: false,
    details: { operation: 'probeAgents', limit: 1_000 },
  });
  expectPortUnobserved(port);

  port.enqueueResolution({ status: 'resolved', executable: '/resolved/a' });
  port.enqueueVersionStart(exited());
  const result = await manager.probeAgents(Array.from({ length: 1_000 }, () => reference('a')));
  expect(result).toHaveLength(1_000);
  expect(result.every((item) => item === result[0])).toBe(true);
  expect(port.calls()).toEqual([
    { type: 'resolve', command: '/fixture/bin/a' },
    expect.objectContaining({ type: 'start-version', executable: '/resolved/a' }),
  ]);
});

test('returns package-owned frozen empty batch output without effects', async () => {
  const { manager, port } = await managerWithDefinitions([requiredVersionProbe('a')]);

  const result = await manager.probeAgents([]);

  expect(result).toEqual([]);
  expect(Object.isFrozen(result)).toBe(true);
  expectPortUnobserved(port);
});

test('preserves input order, unavailable positions, and duplicate result identity', async () => {
  const available = requiredVersionProbe('available');
  const unavailable = buildAgentDefinition({
    ...requiredVersionProbe('unavailable'),
    constraints: { platforms: ['darwin'] },
  });
  const { manager, port } = await managerWithDefinitions([available, unavailable]);
  port.enqueueResolution({ status: 'resolved', executable: '/resolved/available' });
  port.enqueueVersionStart(exited());

  const result = await manager.probeAgents([
    reference('available'),
    reference('unavailable'),
    reference('available'),
  ]);

  expect(result.map(({ agent }) => agent)).toEqual([
    reference('available'),
    reference('unavailable'),
    reference('available'),
  ]);
  expect(result[1]?.status).toBe('unavailable');
  expect(result[0]).toBe(result[2]);
  expect(Object.isFrozen(result)).toBe(true);
  const duplicate = result[0];
  expect(duplicate).toBeDefined();
  if (duplicate !== undefined) expect(Object.isFrozen(duplicate)).toBe(true);
  expect(port.calls()).toEqual([
    { type: 'resolve', command: '/fixture/bin/available' },
    expect.objectContaining({ type: 'start-version', executable: '/resolved/available' }),
  ]);
});

test('does not cache or coalesce physical work across calls', async () => {
  const { manager, port } = await managerWithDefinitions([requiredVersionProbe('a')]);
  for (let count = 0; count < 4; count += 1)
    port.enqueueResolution({ status: 'resolved', executable: `/resolved/a-${count}` });
  for (let count = 0; count < 4; count += 1) port.enqueueVersionStart(exited());

  const singleOne = await manager.probeAgent(reference('a'));
  const singleTwo = await manager.probeAgent(reference('a'));
  const batchOne = await manager.probeAgents([reference('a')]);
  const batchTwo = await manager.probeAgents([reference('a')]);

  expect(singleOne).not.toBe(singleTwo);
  expect(singleOne).not.toBe(batchOne[0]);
  expect(batchOne[0]).not.toBe(batchTwo[0]);
  expect(port.calls()).toEqual([
    { type: 'resolve', command: '/fixture/bin/a' },
    expect.objectContaining({ type: 'start-version', executable: '/resolved/a-0' }),
    { type: 'resolve', command: '/fixture/bin/a' },
    expect.objectContaining({ type: 'start-version', executable: '/resolved/a-1' }),
    { type: 'resolve', command: '/fixture/bin/a' },
    expect.objectContaining({ type: 'start-version', executable: '/resolved/a-2' }),
    { type: 'resolve', command: '/fixture/bin/a' },
    expect.objectContaining({ type: 'start-version', executable: '/resolved/a-3' }),
  ]);
});

test('propagates the evaluator-owned internal fault after the whole batch wave settles', async () => {
  const { manager, port } = await managerWithDefinitions([
    requiredVersionProbe('bad'),
    withVersionProbe('held'),
  ]);
  port.enqueueResolution(new Error('raw port failure'));
  port.enqueueResolution({ status: 'resolved', executable: '/resolved/held' });
  port.enqueueVersionStart('running');

  const batch = manager.probeAgents([reference('bad'), reference('held')]);
  let settled = false;
  void batch.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await flushMicrotasks();

  expect(port.calls()).toEqual([
    { type: 'resolve', command: '/fixture/bin/bad' },
    { type: 'resolve', command: '/fixture/bin/held' },
    {
      type: 'start-version',
      executable: '/resolved/held',
      args: ['--version'],
      shell: false,
      timeoutMs: 1_000,
      stdoutLimitBytes: 65_536,
      stderrLimitBytes: 65_536,
    },
  ]);
  expect(settled).toBe(false);

  port.settleCompletion(1, exited());
  await expectFault(batch, internalProbeFault, 'raw port failure');
});

test('shares one FIFO cap across private discovery APIs and yields before a later batch wave', async () => {
  const batchDefinitions = Array.from({ length: 9 }, (_, index) =>
    withVersionProbe(`batch-${index}`),
  );
  const { manager, port } = await managerWithDefinitions([
    ...batchDefinitions,
    withVersionProbe('single'),
  ]);
  for (let index = 0; index < 10; index += 1) {
    port.enqueueResolution({ status: 'resolved', executable: `/resolved/${index}` });
    port.enqueueVersionStart('running');
  }

  const batch = manager.probeAgents(
    batchDefinitions.map(({ id, version }) => reference(id, version)),
  );
  await flushMicrotasks();
  expect(port.calls().filter(({ type }) => type === 'start-version')).toHaveLength(8);
  expect(port.maximumActiveVersionProbes()).toBe(8);

  const single = manager.probeAgent(reference('single'));
  for (let probeId = 1; probeId <= 8; probeId += 1) port.settleCompletion(probeId, exited());
  await flushMicrotasks();

  const calls = port.calls();
  const singleResolve = calls.findIndex(
    (call) => call.type === 'resolve' && call.command === '/fixture/bin/single',
  );
  const ninthBatchResolve = calls.findIndex(
    (call) => call.type === 'resolve' && call.command === '/fixture/bin/batch-8',
  );
  expect(singleResolve).toBeGreaterThanOrEqual(0);
  expect(ninthBatchResolve).toBeGreaterThan(singleResolve);
  expect(port.maximumActiveVersionProbes()).toBeLessThanOrEqual(8);

  port.settleCompletion(9, exited());
  port.settleCompletion(10, exited());
  const [singleResult, batchResult] = await Promise.all([single, batch]);
  expect(singleResult.status).toBe('available');
  expect(batchResult).toHaveLength(9);
  expect(Object.isFrozen(batchResult)).toBe(true);
});

test('rejects probes after lifecycle manager closing', async () => {
  const definition = withVersionProbe('gap-probe-after-close');
  const { manager, port } = await managerWithDefinitions([definition]);
  await expect(manager.shutdown('closing lifecycle')).resolves.toBeUndefined();

  await expectFault(manager.probeAgent(reference('gap-probe-after-close')), {
    code: 'revo.agent.manager_closed',
    message: AGENT_FAULT_MESSAGES.managerClosed,
    phase: 'manager',
    retryable: false,
  });
  expectPortUnobserved(port);
});

test('rejects probing before initialization without observing the port', async () => {
  const { manager, port } = createProbeCapableManager([withVersionProbe('before-init')]);
  await expectFault(manager.probeAgent(reference('before-init')), {
    code: 'revo.agent.manager_not_initialized',
    message: AGENT_FAULT_MESSAGES.managerNotInitialized,
    phase: 'initializing',
    retryable: false,
  });
  expectPortUnobserved(port);
});

test('closing before initialization wins over readiness for probing', async () => {
  const { manager, port } = createProbeCapableManager([withVersionProbe('closed-first')]);
  await manager.shutdown();
  await expectFault(manager.probeAgent(reference('closed-first')), {
    code: 'revo.agent.manager_closed',
    message: AGENT_FAULT_MESSAGES.managerClosed,
    phase: 'manager',
    retryable: false,
  });
  expectPortUnobserved(port);
});

test('fails closed after rejected initialization', async () => {
  const { manager, port } = createProbeCapableManager([withVersionProbe('rejected-init')]);
  // @ts-expect-error Deliberately malformed recovery row.
  await expect(manager.initialize([{}])).rejects.toBeInstanceOf(AgentManagerError);
  await expectFault(manager.probeAgent(reference('rejected-init')), {
    code: 'revo.agent.manager_closed',
    message: AGENT_FAULT_MESSAGES.managerClosed,
    phase: 'manager',
    retryable: false,
  });
  expectPortUnobserved(port);
});

test('keeps sealed registry reads available after shutdown', async () => {
  const definition = withVersionProbe('read-after-shutdown');
  const { manager, port } = await managerWithDefinitions([definition]);
  await manager.shutdown();
  expect(manager.listAgents()).toHaveLength(1);
  expect(manager.getAgent(reference('read-after-shutdown'))?.agent).toEqual(
    reference('read-after-shutdown'),
  );
  expectPortUnobserved(port);
});

test('rejects a queued probe at dequeue time after closing', async () => {
  const definitions = Array.from({ length: 9 }, (_, index) => withVersionProbe(`queued-${index}`));
  const { manager, port } = await managerWithDefinitions(definitions);
  for (let index = 0; index < 9; index += 1) {
    port.enqueueResolution({ status: 'resolved', executable: `/resolved/queued-${index}` });
    port.enqueueVersionStart('running');
  }

  const batch = manager.probeAgents(definitions.map(({ id, version }) => reference(id, version)));
  await flushMicrotasks();
  expect(port.calls().filter(({ type }) => type === 'start-version')).toHaveLength(8);
  const shutdown = manager.shutdown();
  await flushMicrotasks();
  for (let probeId = 1; probeId <= 8; probeId += 1) port.settleTermination(probeId);
  await shutdown;

  await expectFault(batch, {
    code: 'revo.agent.manager_closed',
    message: AGENT_FAULT_MESSAGES.managerClosed,
    phase: 'manager',
    retryable: false,
  });
  expect(port.calls().filter(({ type }) => type === 'start-version')).toHaveLength(8);
});

test('drains an already spawned probe before rejecting its caller', async () => {
  const { manager, port } = await managerWithDefinitions([withVersionProbe('drain')]);
  port.enqueueResolution({ status: 'resolved', executable: '/resolved/drain' });
  port.enqueueVersionStart('running');

  const probe = manager.probeAgent(reference('drain'));
  await flushMicrotasks();
  const shutdown = manager.shutdown();
  await flushMicrotasks();
  expect(port.calls()).toContainEqual({ type: 'terminate-and-reap', probeId: 1 });

  let probeSettled = false;
  void probe.then(
    () => {
      probeSettled = true;
    },
    () => {
      probeSettled = true;
    },
  );
  await flushMicrotasks();
  expect(probeSettled).toBe(false);
  let shutdownSettled = false;
  void shutdown.finally(() => {
    shutdownSettled = true;
  });
  await flushMicrotasks();
  expect(shutdownSettled).toBe(false);
  port.settleTermination(1);
  await expect(probe).rejects.toBeInstanceOf(AgentManagerError);
  await expect(shutdown).resolves.toBeUndefined();
});

test('reports unconfirmed probe cleanup without exposing an invocation id', async () => {
  const { manager, port } = await managerWithDefinitions([withVersionProbe('failed-drain')]);
  port.enqueueResolution({ status: 'resolved', executable: '/resolved/failed-drain' });
  port.enqueueVersionStart('running');

  const probe = manager.probeAgent(reference('failed-drain'));
  await flushMicrotasks();
  const shutdown = manager.shutdown();
  await flushMicrotasks();
  port.settleTermination(1, {
    cause: 'group_still_live',
    termSent: true,
    killSent: true,
    lastKnownGroupState: 'present',
    leaderReapState: 'pending',
  });

  await expectFault(probe, {
    code: 'revo.agent.manager_closed',
    message: AGENT_FAULT_MESSAGES.managerClosed,
    phase: 'manager',
    retryable: false,
  });
  await expectFault(shutdown, {
    code: 'revo.agent.shutdown_failed',
    message: AGENT_FAULT_MESSAGES.shutdownFailed,
    phase: 'shutdown',
    retryable: false,
    details: { failureCount: 1 },
  });
});

test('retains an unconfirmed own-timeout cleanup for a later shutdown', async () => {
  const { manager, port } = await managerWithDefinitions([withVersionProbe('timeout-retained')]);
  port.enqueueResolution({ status: 'resolved', executable: '/resolved/timeout-retained' });
  port.enqueueVersionStart('running');

  const probe = manager.probeAgent(reference('timeout-retained'));
  await flushMicrotasks();
  port.fireTimeout(1);
  await flushMicrotasks();
  port.settleTermination(1, {
    cause: 'leader_reap_timeout',
    termSent: true,
    killSent: false,
    lastKnownGroupState: 'absent',
    leaderReapState: 'pending',
  });
  await expect(probe).resolves.toMatchObject({
    status: 'unavailable',
    error: {
      code: 'revo.agent.probe_timeout',
      message: AGENT_FAULT_MESSAGES.probeTimeout,
      phase: 'probing',
      retryable: true,
      details: { timeoutMs: 1_000 },
    },
  });
  await expectFault(manager.shutdown(), {
    code: 'revo.agent.shutdown_failed',
    message: AGENT_FAULT_MESSAGES.shutdownFailed,
    phase: 'shutdown',
    retryable: false,
    details: { failureCount: 1 },
  });
});

test('checks closing before malformed references and batch limits', async () => {
  const { manager, port } = await managerWithDefinitions([withVersionProbe('closed-input')]);
  await manager.shutdown();

  // @ts-expect-error Deliberately malformed runtime probe reference.
  await expectFault(manager.probeAgent({}), {
    code: 'revo.agent.manager_closed',
    message: AGENT_FAULT_MESSAGES.managerClosed,
    phase: 'manager',
    retryable: false,
  });
  await expectFault(
    manager.probeAgents(Array.from({ length: 1_001 }, () => reference('closed-input'))),
    {
      code: 'revo.agent.manager_closed',
      message: AGENT_FAULT_MESSAGES.managerClosed,
      phase: 'manager',
      retryable: false,
    },
  );
  expectPortUnobserved(port);
});
