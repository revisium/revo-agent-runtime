import { expect, test, vi } from 'vitest';

import { createInvocationLifecycleManager } from '../../../src/application/manager/index.js';
import { validateManagerOptions } from '../../../src/runtime/definition/index.js';
import { AgentManagerError } from '../../../src/runtime/errors/index.js';
import type {
  InvocationExecutionPorts,
  WorkspaceAdmissionResult,
} from '../../../src/runtime/execution/index.js';
import { AGENT_FAULT_MESSAGES } from '../../../src/runtime/policy/index.js';
import type { ExecutableProbePort } from '../../../src/runtime/probe/index.js';
import { buildAgentDefinition } from '../../support/definition/build-agent-definition.js';
import { FakeInvocationClock } from '../../support/execution/fake-clock.js';
import { FakeInvocationExecutionPort } from '../../support/execution/fake-execution-port.js';
import { FakeOutputClaimPort } from '../../support/execution/fake-output-claim-port.js';
import { FakeInvocationOutputPort } from '../../support/execution/fake-output-port.js';
import { FakeOutputPreparationPort } from '../../support/execution/fake-output-preparation-port.js';
import { FakeExecutableProbePort } from '../../support/probe/fake-executable-probe-port.js';

const resultSchema = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
});

const defaultEffectiveLimits = Object.freeze({
  wallClockTimeoutMs: 1_800_000,
  idleTimeoutMs: 300_000,
  maxEventBytes: 65_536,
  maxEventsFileBytes: 16_777_216,
  maxStdoutBytes: 8_388_608,
  maxStderrBytes: 8_388_608,
  maxRawResponseBytes: 1_048_576,
});

const createStartInput = (
  definition: ReturnType<typeof buildAgentDefinition>,
  overrides: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> =>
  Object.freeze({
    invocationId: 'foundation-preflight',
    agent: Object.freeze({ id: definition.id, version: definition.version }),
    prompt: 'Return JSON.',
    workspace: Object.freeze({ directory: '/approved/workspace' }),
    parameters: Object.freeze({}),
    permissions: Object.freeze({}),
    result: Object.freeze({ schema: resultSchema }),
    output: Object.freeze({ directory: '/outputs/invocation' }),
    ...overrides,
  });

const outputAdmissionCall = (invocationId: string) =>
  Object.freeze({
    type: 'admit' as const,
    request: {
      invocationId,
      outputDirectory: '/outputs/invocation',
      needsPromptFile: false,
      needsResultSchemaFile: false,
    },
  });

const exited = (version = '1.0.0') =>
  Object.freeze({
    status: 'exited' as const,
    exitCode: 0,
    signal: null,
    stdout: new TextEncoder().encode(`agent ${version}\n`),
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
  workspace: ReturnType<typeof vi.fn>;
  ports: InvocationExecutionPorts;
}> => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  const outputPreparation = new FakeOutputPreparationPort('prepared');
  const probe = new FakeExecutableProbePort({ platform });
  const workspace = vi.fn(
    async () =>
      workspaceAdmission ??
      Object.freeze({ status: 'admitted' as const, directory: '/approved/workspace' }),
  );
  const ports = {
    execution,
    output,
    outputPreparation,
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    outputClaim: new FakeOutputClaimPort('created'),
    executableProbe: probe,
    workspace: { admit: workspace },
  };
  return Object.freeze({ execution, output, probe, workspace, ports });
};

test('rejects workspace admission before output preparation or execution delegation', async () => {
  const { execution, output, probe, workspace, ports } = createPorts('linux', {
    status: 'rejected',
    reason: 'invalid_path',
  });
  const definition = buildAgentDefinition();
  const manager = createInvocationLifecycleManager({ definitions: [definition] }, ports);

  await expect(
    manager.start(
      createStartInput(definition, {
        invocationId: 'invalid-workspace',
        workspace: { directory: '../relative/./hostile\u0000path' },
      }),
    ),
  ).resolves.toMatchObject({ status: 'rejected', reason: 'preflight_failed' });
  expect(workspace).toHaveBeenCalledExactlyOnceWith('../relative/./hostile\u0000path');
  expect(probe.calls()).toEqual([]);
  expect(output.calls()).toEqual([]);
  expect(execution.calls()).toEqual([]);
});

test('admits a normalized absolute workspace before output preparation and execution', async () => {
  const { execution, output, probe, workspace, ports } = createPorts('linux', {
    status: 'admitted',
    directory: '/approved/workspace',
  });
  const definition = buildAgentDefinition();
  const manager = createInvocationLifecycleManager({ definitions: [definition] }, ports);
  probe.enqueueResolution({ status: 'resolved', executable: '/resolved/workspace-agent' });
  probe.enqueueVersionStart('running');
  output.enqueueTerminalResultRecording();
  execution.enqueueStart('running');

  const started = manager.start(
    createStartInput(definition, {
      invocationId: 'valid-workspace',
      workspace: { directory: '/approved/workspace' },
    }),
  );
  await flush();
  probe.settleCompletion(1, exited());

  await expect(started).resolves.toMatchObject({ status: 'accepted' });
  expect(workspace).toHaveBeenCalledExactlyOnceWith('/approved/workspace');
  expect(output.calls()[0]).toEqual(outputAdmissionCall('valid-workspace'));
  expect(execution.calls()).toEqual([{ type: 'start' }]);
});

test('freshly probes every invocation before output preparation and execution delegation', async () => {
  const { execution, output, probe, ports } = createPorts('linux');
  const definition = buildAgentDefinition();
  const [validatedDefinition] = validateManagerOptions({ definitions: [definition] }).definitions;
  if (validatedDefinition === undefined) throw new Error('Expected validated definition');
  const manager = createInvocationLifecycleManager({ definitions: [definition] }, ports);

  for (const executable of ['/resolved/first', '/resolved/second']) {
    probe.enqueueResolution({ status: 'resolved', executable });
    probe.enqueueVersionStart('running');
    output.enqueueTerminalResultRecording();
    execution.enqueueStart('running');
  }

  const first = manager.start(createStartInput(definition, { invocationId: 'first' }));
  await flush();
  expect(execution.calls()).toEqual([]);
  expect(output.calls()).toEqual([outputAdmissionCall('first')]);
  probe.settleCompletion(1, exited());
  const firstAccepted = await first;
  expect(firstAccepted.status).toBe('accepted');

  const second = manager.start(createStartInput(definition, { invocationId: 'second' }));
  await flush();
  probe.settleCompletion(2, exited('1.0.1'));
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
  const [firstPrepared, secondPrepared] = execution.startedPreparedLaunches();
  expect(firstPrepared).toEqual({
    pin: {
      agentId: definition.id,
      agentVersion: definition.version,
      definitionDigest: validatedDefinition.definitionDigest,
    },
    executable: '/resolved/first',
    reportedVersion: '1.0.0',
    limits: defaultEffectiveLimits,
    effectiveParameters: {},
    effectivePermissions: {},
    binding: {
      protocolDriverId: 'native/stdio-v1',
      resultParserId: 'codex-jsonl/v1',
      permissionStrategyId: 'codex-cli/v1',
      delivery: { prompt: 'argument', resultSchema: 'argument', result: 'stdout' },
    },
  });
  expect(secondPrepared).toEqual({
    pin: {
      agentId: definition.id,
      agentVersion: definition.version,
      definitionDigest: validatedDefinition.definitionDigest,
    },
    executable: '/resolved/second',
    reportedVersion: '1.0.1',
    limits: defaultEffectiveLimits,
    effectiveParameters: {},
    effectivePermissions: {},
    binding: {
      protocolDriverId: 'native/stdio-v1',
      resultParserId: 'codex-jsonl/v1',
      permissionStrategyId: 'codex-cli/v1',
      delivery: { prompt: 'argument', resultSchema: 'argument', result: 'stdout' },
    },
  });
  expect(firstPrepared?.childEnvironment).toEqual({});
  expect(secondPrepared?.childEnvironment).toEqual({});
  expect(firstPrepared).not.toBe(secondPrepared);
});

test('rejects version mismatch before output preparation or execution delegation', async () => {
  const { execution, output, probe, ports } = createPorts('linux');
  const definition = buildAgentDefinition();
  const manager = createInvocationLifecycleManager({ definitions: [definition] }, ports);
  probe.enqueueResolution({ status: 'resolved', executable: '/resolved/version-mismatch-agent' });
  probe.enqueueVersionStart('running');

  const started = manager.start(createStartInput(definition, { invocationId: 'version-mismatch' }));
  await flush();
  probe.settleCompletion(1, exited('2.0.0'));

  await expect(started).resolves.toMatchObject({ status: 'rejected', reason: 'preflight_failed' });
  expect(output.calls()).toEqual([outputAdmissionCall('version-mismatch')]);
  expect(execution.calls()).toEqual([]);
});

test('orders fresh executable proof after resource-bound preflight and before output claim', async () => {
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  const probe = new FakeExecutableProbePort({ platform: 'linux' });
  const order: string[] = [];
  const definition = buildAgentDefinition();
  probe.enqueueResolution({ status: 'resolved', executable: '/resolved/ordered-agent' });
  probe.enqueueVersionStart('running');
  output.enqueueTerminalResultRecording();
  execution.enqueueStart('running');
  const ports: InvocationExecutionPorts & Readonly<{ executableProbe: ExecutableProbePort }> = {
    execution: {
      start: async (snapshot, preparedLaunch) => {
        order.push('execution-start');
        return await execution.start(snapshot, preparedLaunch);
      },
    },
    output: {
      admit: async (request) => {
        order.push('output-admit');
        return await output.admit(request);
      },
      appendLifecycleEvent: (authority, event) => output.appendLifecycleEvent(authority, event),
      publishTerminalResult: (authority, result) => output.publishTerminalResult(authority, result),
      publishRawResponse: (authority, eligibility, bytes) =>
        output.publishRawResponse(authority, eligibility, bytes),
      cleanupScratch: (authority) => output.cleanupScratch(authority),
    },
    clock: new FakeInvocationClock({ initialNowMs: 0 }),
    outputClaim: new FakeOutputClaimPort('created'),
    outputPreparation: {
      prepareClaimedOutput: (request) => {
        order.push('output-prepare');
        return new FakeOutputPreparationPort('prepared').prepareClaimedOutput(request);
      },
    },
    executableProbe: {
      hostPlatform: () => probe.hostPlatform(),
      resolveExecutable: async (request) => {
        order.push('probe-resolve');
        return await probe.resolveExecutable(request);
      },
      startVersionProbe: async (request) => {
        order.push('probe-start');
        return await probe.startVersionProbe(request);
      },
    },
    workspace: {
      admit: async () => {
        order.push('workspace-admit');
        return Object.freeze({ status: 'admitted' as const, directory: '/approved/workspace' });
      },
    },
  };
  const manager = createInvocationLifecycleManager({ definitions: [definition] }, ports);

  const started = manager.start(createStartInput(definition, { invocationId: 'ordered-proof' }));
  await flush();
  await flush();
  expect([...order]).toEqual(['workspace-admit', 'output-admit', 'probe-resolve', 'probe-start']);

  probe.settleCompletion(1, exited());
  await expect(started).resolves.toMatchObject({ status: 'accepted' });
  expect([...order]).toEqual([
    'workspace-admit',
    'output-admit',
    'probe-resolve',
    'probe-start',
    'output-prepare',
    'execution-start',
  ]);
  expect(execution.startedPreparedLaunches()[0]?.executable).toBe('/resolved/ordered-agent');
});

test('rejects malformed launch evidence before output preparation or execution delegation', async () => {
  const { execution, output, probe, ports } = createPorts('linux');
  const definition = buildAgentDefinition();
  const manager = createInvocationLifecycleManager({ definitions: [definition] }, ports);
  probe.enqueueResolution({ status: 'resolved', executable: '' });
  probe.enqueueVersionStart('running');

  const started = manager.start(
    createStartInput(definition, { invocationId: 'malformed-launch-evidence' }),
  );
  await flush();

  await expect(started).resolves.toMatchObject({ status: 'rejected', reason: 'preflight_failed' });
  expect(output.calls()).toEqual([outputAdmissionCall('malformed-launch-evidence')]);
  expect(probe.calls()).toEqual([{ type: 'resolve', command: '/fixture/bin/agent' }]);
  expect(execution.calls()).toEqual([]);
});

test('fails target-platform preflight before output preparation or execution delegation', async () => {
  const { execution, output, probe, ports } = createPorts('darwin');
  const definition = buildAgentDefinition();
  const manager = createInvocationLifecycleManager({ definitions: [definition] }, ports);

  try {
    await manager.start(createStartInput(definition, { invocationId: 'unsupported' }));
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
  expect(output.calls()).toEqual([outputAdmissionCall('unsupported')]);
  expect(execution.calls()).toEqual([]);
});

test('reserves an invocation id before probing and retains that reservation after completion', async () => {
  const { execution, output, probe, ports } = createPorts('linux');
  const definition = buildAgentDefinition();
  const manager = createInvocationLifecycleManager({ definitions: [definition] }, ports);
  probe.enqueueResolution({ status: 'resolved', executable: '/resolved/duplicate' });
  probe.enqueueVersionStart('running');
  output.enqueueTerminalResultRecording();
  execution.enqueueStart('running');
  const input = createStartInput(definition, { invocationId: 'duplicate' });

  const first = manager.start(input);
  await flush();
  await expect(manager.start(input)).resolves.toEqual({
    status: 'rejected',
    reason: 'duplicate_invocation',
  });
  expect(probe.calls()).toHaveLength(2);
  expect(output.calls()).toEqual([outputAdmissionCall('duplicate')]);

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
});

test('maps a missing preflight composition port to a typed pre-acceptance rejection', async () => {
  const definition = buildAgentDefinition();
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  const manager = createInvocationLifecycleManager(
    { definitions: [definition] },
    {
      execution,
      output,
      clock: new FakeInvocationClock({ initialNowMs: 0 }),
      outputClaim: new FakeOutputClaimPort('created'),
      outputPreparation: new FakeOutputPreparationPort('prepared'),
      workspace: {
        admit: async () =>
          Object.freeze({ status: 'admitted' as const, directory: '/approved/workspace' }),
      },
    },
  );

  await expect(
    manager.start(createStartInput(definition, { invocationId: 'missing-probe-port' })),
  ).resolves.toMatchObject({ status: 'rejected', reason: 'preflight_failed' });
  expect(output.calls()).toEqual([outputAdmissionCall('missing-probe-port')]);
  expect(execution.calls()).toEqual([]);
});

test.each([
  ['missing workspace port', {}],
  ['missing workspace admit function', { workspace: {} }],
] as const)(
  'maps malformed %s to a typed pre-acceptance rejection',
  async (_name, malformedWorkspacePort) => {
    const definition = buildAgentDefinition();
    const execution = new FakeInvocationExecutionPort();
    const output = new FakeInvocationOutputPort();
    const probe = new FakeExecutableProbePort({ platform: 'linux' });
    const ports = {
      execution,
      output,
      clock: new FakeInvocationClock({ initialNowMs: 0 }),
      outputClaim: new FakeOutputClaimPort('created'),
      outputPreparation: new FakeOutputPreparationPort('prepared'),
      executableProbe: probe,
      ...malformedWorkspacePort,
    };
    // @ts-expect-error Deliberately exercises unsafe JavaScript composition.
    const manager = createInvocationLifecycleManager({ definitions: [definition] }, ports);

    await expect(
      manager.start(createStartInput(definition, { invocationId: `malformed-${_name}` })),
    ).resolves.toMatchObject({ status: 'rejected', reason: 'preflight_failed' });
    expect(probe.calls()).toEqual([]);
    expect(output.calls()).toEqual([]);
    expect(execution.calls()).toEqual([]);
  },
);
