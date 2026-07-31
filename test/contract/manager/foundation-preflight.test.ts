import { expect, test, vi } from 'vitest';

import { createInvocationLifecycleManager } from '../../../src/application/manager/index.js';
import { AgentManagerError } from '../../../src/runtime/errors/index.js';
import type {
  InvocationExecutionPorts,
  WorkspaceAdmissionResult,
} from '../../../src/runtime/execution/index.js';
import { AGENT_FAULT_MESSAGES } from '../../../src/runtime/policy/index.js';
import { buildAgentDefinition } from '../../support/definition/build-agent-definition.js';
import { FakeInvocationClock } from '../../support/execution/fake-clock.js';
import { FakeInvocationExecutionPort } from '../../support/execution/fake-execution-port.js';
import { FakeInvocationOutputPort } from '../../support/execution/fake-output-port.js';
import { FakeExecutableProbePort } from '../../support/probe/fake-executable-probe-port.js';

const resultSchema = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
});

const exited = () =>
  Object.freeze({
    status: 'exited' as const,
    exitCode: 0,
    signal: null,
    stdout: new TextEncoder().encode('agent 1.0.0\n'),
    stderr: new Uint8Array(),
    overflow: 'none' as const,
  });

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const createPorts = (
  platform: 'darwin' | 'linux',
  workspaceAdmission?: WorkspaceAdmissionResult,
): Readonly<{
  execution: FakeInvocationExecutionPort;
  output: FakeInvocationOutputPort;
  probe: FakeExecutableProbePort;
  ports: InvocationExecutionPorts;
}> => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  const probe = new FakeExecutableProbePort({ platform });
  const ports = {
    execution,
    output,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    executableProbe: probe,
    ...(workspaceAdmission === undefined
      ? {}
      : { workspace: { admit: vi.fn(async () => workspaceAdmission) } }),
  } as InvocationExecutionPorts;
  return Object.freeze({ execution, output, probe, ports });
};

test('rejects workspace admission before output preparation or execution delegation', async () => {
  const { execution, output, probe, ports } = createPorts('linux', {
    status: 'rejected',
    reason: 'invalid_path',
  });
  const definition = buildAgentDefinition();
  const manager = createInvocationLifecycleManager({ definitions: [definition] }, ports);

  await expect(
    manager.start({
      invocationId: 'invalid-workspace',
      agent: { id: definition.id, version: definition.version },
      resultSchema,
      workspace: { directory: '../relative/./hostile\u0000path' },
    }),
  ).resolves.toEqual({ status: 'rejected', reason: 'preflight_failed' });
  expect(probe.calls()).toEqual([]);
  expect(output.calls()).toEqual([]);
  expect(execution.calls()).toEqual([]);
});

test('admits a normalized absolute workspace before output preparation and execution', async () => {
  const { execution, output, probe, ports } = createPorts('linux', {
    status: 'admitted',
    directory: '/approved/workspace',
  });
  const definition = buildAgentDefinition();
  const manager = createInvocationLifecycleManager({ definitions: [definition] }, ports);
  probe.enqueueResolution({ status: 'resolved', executable: '/resolved/workspace-agent' });
  probe.enqueueVersionStart('running');
  output.enqueuePrepare();
  output.enqueueTerminalResultRecording();
  execution.enqueueStart('running');

  const started = manager.start({
    invocationId: 'valid-workspace',
    agent: { id: definition.id, version: definition.version },
    resultSchema,
    workspace: { directory: '/approved/workspace' },
  });
  await flush();
  probe.settleCompletion(1, exited());

  await expect(started).resolves.toMatchObject({ status: 'accepted' });
  expect(output.calls()[0]).toEqual({ type: 'prepare' });
  expect(execution.calls()).toEqual([{ type: 'start' }]);
});

test('freshly probes every invocation before output preparation and execution delegation', async () => {
  const { execution, output, probe, ports } = createPorts('linux');
  const definition = buildAgentDefinition();
  const manager = createInvocationLifecycleManager({ definitions: [definition] }, ports);

  for (const executable of ['/resolved/first', '/resolved/second']) {
    probe.enqueueResolution({ status: 'resolved', executable });
    probe.enqueueVersionStart('running');
    output.enqueuePrepare();
    output.enqueueTerminalResultRecording();
    execution.enqueueStart('running');
  }

  const first = manager.start({
    invocationId: 'first',
    agent: { id: definition.id, version: definition.version },
    resultSchema,
  });
  await flush();
  expect(execution.calls()).toEqual([]);
  expect(output.calls()).toEqual([]);
  probe.settleCompletion(1, exited());
  const firstAccepted = await first;
  expect(firstAccepted.status).toBe('accepted');

  const second = manager.start({
    invocationId: 'second',
    agent: { id: definition.id, version: definition.version },
    resultSchema,
  });
  await flush();
  probe.settleCompletion(2, exited());
  const secondAccepted = await second;
  expect(secondAccepted.status).toBe('accepted');

  expect(probe.calls()).toEqual([
    { type: 'resolve', command: '/fixture/bin/agent' },
    {
      type: 'start-version',
      executable: '/resolved/first',
      args: ['--version'],
      shell: false,
      timeoutMs: 1_000,
      stdoutLimitBytes: 65_536,
      stderrLimitBytes: 65_536,
    },
    { type: 'resolve', command: '/fixture/bin/agent' },
    {
      type: 'start-version',
      executable: '/resolved/second',
      args: ['--version'],
      shell: false,
      timeoutMs: 1_000,
      stdoutLimitBytes: 65_536,
      stderrLimitBytes: 65_536,
    },
  ]);
  expect(execution.calls()).toEqual([{ type: 'start' }, { type: 'start' }]);
});

test('fails target-platform preflight before output preparation or execution delegation', async () => {
  const { execution, output, probe, ports } = createPorts('darwin');
  const definition = buildAgentDefinition();
  const manager = createInvocationLifecycleManager({ definitions: [definition] }, ports);

  try {
    await manager.start({
      invocationId: 'unsupported',
      agent: { id: definition.id, version: definition.version },
      resultSchema,
    });
    throw new Error('Expected target-platform preflight rejection.');
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(AgentManagerError);
    if (!(error instanceof AgentManagerError)) return;
    expect(error.fault).toEqual({
      code: 'revo.agent.platform_unsupported',
      message: AGENT_FAULT_MESSAGES.platformUnsupported,
      phase: 'preflight',
      retryable: false,
      details: { platform: 'darwin' },
    });
  }
  expect(probe.calls()).toEqual([]);
  expect(output.calls()).toEqual([]);
  expect(execution.calls()).toEqual([]);
});

test('reserves an invocation id before probing and retains that reservation after completion', async () => {
  const { execution, output, probe, ports } = createPorts('linux');
  const definition = buildAgentDefinition();
  const manager = createInvocationLifecycleManager({ definitions: [definition] }, ports);
  probe.enqueueResolution({ status: 'resolved', executable: '/resolved/duplicate' });
  probe.enqueueVersionStart('running');
  output.enqueuePrepare();
  output.enqueueTerminalResultRecording();
  execution.enqueueStart('running');
  const input = {
    invocationId: 'duplicate',
    agent: { id: definition.id, version: definition.version },
    resultSchema,
  };

  const first = manager.start(input);
  await flush();
  await expect(manager.start(input)).resolves.toEqual({
    status: 'rejected',
    reason: 'duplicate_invocation',
  });
  expect(probe.calls()).toHaveLength(2);
  expect(output.calls()).toEqual([]);

  probe.settleCompletion(1, exited());
  const accepted = await first;
  if (accepted.status !== 'accepted') throw new Error('Expected accepted first invocation.');
  await flush();
  execution.settleNaturalCompletion(1, new TextEncoder().encode('{}'));
  await accepted.handle.result();

  await expect(manager.start(input)).resolves.toEqual({
    status: 'rejected',
    reason: 'duplicate_invocation',
  });
  expect(probe.calls()).toHaveLength(2);
  expect(output.calls().filter((call) => call.type === 'prepare')).toHaveLength(1);
});

test('maps a missing preflight composition port to a typed pre-acceptance rejection', async () => {
  const definition = buildAgentDefinition();
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  const manager = createInvocationLifecycleManager(
    { definitions: [definition] },
    { execution, output, clock: new FakeInvocationClock({ initialNowMs: 0 }) },
  );

  await expect(
    manager.start({
      invocationId: 'missing-probe-port',
      agent: { id: definition.id, version: definition.version },
      resultSchema,
    }),
  ).resolves.toEqual({ status: 'rejected', reason: 'preflight_failed' });
  expect(output.calls()).toEqual([]);
  expect(execution.calls()).toEqual([]);
});
