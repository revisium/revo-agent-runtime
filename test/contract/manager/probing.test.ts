import { expect, test } from 'vitest';

import * as managerModule from '../../../src/application/manager/index.js';
import { createProbeableAgentDiscovery } from '../../../src/application/manager/index.js';
import { AgentManagerError } from '../../../src/runtime/errors/index.js';
import { AGENT_FAULT_MESSAGES } from '../../../src/runtime/policy/index.js';
import type { AgentDefinitionInput, AgentRef } from '../../../src/runtime/spec/index.js';
import { buildAgentDefinition } from '../../support/definition/build-agent-definition.js';
import { FakeExecutableProbePort } from '../../support/probe/fake-executable-probe-port.js';

const flushMicrotasks = async (remaining = 12): Promise<void> => {
  if (remaining === 0) return;
  await Promise.resolve();
  await flushMicrotasks(remaining - 1);
};

const reference = (id: string, version = '1.0.0'): AgentRef => ({ id, version });

const withoutVersionProbe = (id: string, version = '1.0.0'): AgentDefinitionInput =>
  buildAgentDefinition({
    id,
    version,
    displayName: id,
    launch: {
      command: `/fixture/bin/${id}`,
      args: [{ kind: 'prompt' }, { kind: 'result-schema' }],
    },
    constraints: { platforms: ['linux'] },
  });

const withVersionProbe = (id: string, version = '1.0.0'): AgentDefinitionInput =>
  buildAgentDefinition({
    id,
    version,
    displayName: id,
    launch: { ...buildAgentDefinition().launch, command: `/fixture/bin/${id}` },
  });

const discoveryWithDefinitions = (definitions: readonly AgentDefinitionInput[]) => {
  const port = new FakeExecutableProbePort({ platform: 'linux' });
  return { discovery: createProbeableAgentDiscovery({ definitions }, port), port };
};

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
  expect(managerModule).toHaveProperty('createProbeableAgentDiscovery');
  expect(managerModule).not.toHaveProperty('createAgentDiscovery');
});

test('probes one exact agent through a new admitted physical operation', async () => {
  const { discovery, port } = discoveryWithDefinitions([withoutVersionProbe('a')]);
  port.enqueueResolution({ status: 'resolved', executable: '/resolved/a' });

  const result = await discovery.probeAgent(reference('a'));

  expect(result).toMatchObject({
    status: 'available',
    agent: reference('a'),
    executable: '/resolved/a',
  });
  expect(port.calls()).toEqual([{ type: 'resolve', command: '/fixture/bin/a' }]);
  expect(Object.isFrozen(result)).toBe(true);
});

test('propagates the evaluator-owned internal fault through one probe without raw error text', async () => {
  const { discovery, port } = discoveryWithDefinitions([withoutVersionProbe('a')]);
  port.enqueueResolution(new Error('single raw port failure'));

  const operation = discovery.probeAgent(reference('a'));
  expect(operation).toBeInstanceOf(Promise);
  await expectFault(operation, internalProbeFault, 'single raw port failure');
});

test('rejects malformed and unknown single references asynchronously before port observation', async () => {
  const { discovery, port } = discoveryWithDefinitions([withoutVersionProbe('a')]);

  const malformedReference = reference('a');
  Reflect.deleteProperty(malformedReference, 'version');
  const malformed = discovery.probeAgent(malformedReference);
  expect(malformed).toBeInstanceOf(Promise);
  await expectFault(malformed, unknownFault({ operation: 'probeAgent' }));
  await expectFault(
    discovery.probeAgent(reference('missing')),
    unknownFault({ operation: 'probeAgent' }),
  );

  expectPortUnobserved(port);
});

test('rejects malformed outer batch containers before registry or port observation', async () => {
  const { discovery, port } = discoveryWithDefinitions([withoutVersionProbe('a')]);
  const customPrototype: AgentRef[] = [reference('a')];
  Object.setPrototypeOf(customPrototype, null);
  const sparse = new Array<AgentRef>(1);
  const trapped = new Proxy<AgentRef[]>([], {
    ownKeys: () => {
      throw new Error('outer-inspection-trap');
    },
  });
  const operations = [customPrototype, sparse, trapped].map((refs) => discovery.probeAgents(refs));

  for (const operation of operations) expect(operation).toBeInstanceOf(Promise);
  await Promise.all(
    operations.map((operation) =>
      expectFault(operation, unknownFault({ operation: 'probeAgents' }), 'outer-inspection-trap'),
    ),
  );

  expectPortUnobserved(port);
});

test('accepts a transparent array proxy when its observable shape is ordinary', async () => {
  const { discovery, port } = discoveryWithDefinitions([withoutVersionProbe('a')]);
  port.enqueueResolution({ status: 'resolved', executable: '/resolved/a' });

  const result = await discovery.probeAgents(new Proxy([reference('a')], {}));

  expect(result).toHaveLength(1);
  expect(port.calls()).toEqual([{ type: 'resolve', command: '/fixture/bin/a' }]);
});

test('prevalidates every batch input in order before it admits physical work', async () => {
  const { discovery, port } = discoveryWithDefinitions([withoutVersionProbe('a')]);
  const malformedReference = reference('bad');
  Reflect.deleteProperty(malformedReference, 'version');

  await expectFault(
    discovery.probeAgents([reference('a'), malformedReference, reference('missing')]),
    unknownFault({ operation: 'probeAgents', index: 1 }),
  );
  await expectFault(
    discovery.probeAgents([reference('a'), reference('missing'), malformedReference]),
    unknownFault({ operation: 'probeAgents', index: 1 }),
  );

  expectPortUnobserved(port);
});

test('bounds batch length before effects and permits exactly one thousand duplicate refs', async () => {
  const { discovery, port } = discoveryWithDefinitions([withoutVersionProbe('a')]);
  const tooMany = Array.from({ length: 1_001 }, () => reference('a'));
  const sparseTooMany = new Array<AgentRef>(1_001);

  await expectFault(discovery.probeAgents(tooMany), {
    code: 'revo.agent.limit_invalid',
    message: AGENT_FAULT_MESSAGES.limitInvalid,
    phase: 'probing',
    retryable: false,
    details: { operation: 'probeAgents', limit: 1_000 },
  });
  await expectFault(discovery.probeAgents(sparseTooMany), {
    code: 'revo.agent.limit_invalid',
    message: AGENT_FAULT_MESSAGES.limitInvalid,
    phase: 'probing',
    retryable: false,
    details: { operation: 'probeAgents', limit: 1_000 },
  });
  expectPortUnobserved(port);

  port.enqueueResolution({ status: 'resolved', executable: '/resolved/a' });
  const result = await discovery.probeAgents(Array.from({ length: 1_000 }, () => reference('a')));
  expect(result).toHaveLength(1_000);
  expect(result.every((item) => item === result[0])).toBe(true);
  expect(port.calls()).toEqual([{ type: 'resolve', command: '/fixture/bin/a' }]);
});

test('returns package-owned frozen empty batch output without effects', async () => {
  const { discovery, port } = discoveryWithDefinitions([withoutVersionProbe('a')]);

  const result = await discovery.probeAgents([]);

  expect(result).toEqual([]);
  expect(Object.isFrozen(result)).toBe(true);
  expectPortUnobserved(port);
});

test('preserves input order, unavailable positions, and duplicate result identity', async () => {
  const available = withoutVersionProbe('available');
  const unavailable = buildAgentDefinition({
    ...withoutVersionProbe('unavailable'),
    constraints: { platforms: ['darwin'] },
  });
  const { discovery, port } = discoveryWithDefinitions([available, unavailable]);
  port.enqueueResolution({ status: 'resolved', executable: '/resolved/available' });

  const result = await discovery.probeAgents([
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
  expect(port.calls()).toEqual([{ type: 'resolve', command: '/fixture/bin/available' }]);
});

test('does not cache or coalesce physical work across calls', async () => {
  const { discovery, port } = discoveryWithDefinitions([withoutVersionProbe('a')]);
  for (let count = 0; count < 4; count += 1)
    port.enqueueResolution({ status: 'resolved', executable: `/resolved/a-${count}` });

  const singleOne = await discovery.probeAgent(reference('a'));
  const singleTwo = await discovery.probeAgent(reference('a'));
  const batchOne = await discovery.probeAgents([reference('a')]);
  const batchTwo = await discovery.probeAgents([reference('a')]);

  expect(singleOne).not.toBe(singleTwo);
  expect(singleOne).not.toBe(batchOne[0]);
  expect(batchOne[0]).not.toBe(batchTwo[0]);
  expect(port.calls()).toEqual([
    { type: 'resolve', command: '/fixture/bin/a' },
    { type: 'resolve', command: '/fixture/bin/a' },
    { type: 'resolve', command: '/fixture/bin/a' },
    { type: 'resolve', command: '/fixture/bin/a' },
  ]);
});

test('propagates the evaluator-owned internal fault after the whole batch wave settles', async () => {
  const { discovery, port } = discoveryWithDefinitions([
    withoutVersionProbe('bad'),
    withVersionProbe('held'),
  ]);
  port.enqueueResolution(new Error('raw port failure'));
  port.enqueueResolution({ status: 'resolved', executable: '/resolved/held' });
  port.enqueueVersionStart('running');

  const batch = discovery.probeAgents([reference('bad'), reference('held')]);
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
  const { discovery, port } = discoveryWithDefinitions([
    ...batchDefinitions,
    withVersionProbe('single'),
  ]);
  for (let index = 0; index < 10; index += 1) {
    port.enqueueResolution({ status: 'resolved', executable: `/resolved/${index}` });
    port.enqueueVersionStart('running');
  }

  const batch = discovery.probeAgents(
    batchDefinitions.map(({ id, version }) => reference(id, version)),
  );
  await flushMicrotasks();
  expect(port.calls().filter(({ type }) => type === 'start-version')).toHaveLength(8);
  expect(port.maximumActiveVersionProbes()).toBe(8);

  const single = discovery.probeAgent(reference('single'));
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
