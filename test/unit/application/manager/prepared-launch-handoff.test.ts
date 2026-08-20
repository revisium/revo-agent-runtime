import { afterEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ compileConsumerSchema: vi.fn(), probeExecutable: vi.fn() }));

type DefinitionModule = typeof import('../../../../src/runtime/definition/index.js');

vi.mock('../../../../src/runtime/probe/index.js', () => ({
  probeExecutable: mocks.probeExecutable,
}));

vi.mock('../../../../src/runtime/definition/index.js', async (importOriginal) => {
  const actual = await importOriginal<DefinitionModule>();
  mocks.compileConsumerSchema.mockImplementation(actual.compileConsumerSchema);
  return { ...actual, compileConsumerSchema: mocks.compileConsumerSchema };
});

import { createInvocationLifecycleManager } from '../../../../src/application/manager/index.js';
import { InstalledBindingRegistry } from '../../../../src/application/manager/installed-bindings.js';
import { validateManagerOptions } from '../../../../src/runtime/definition/index.js';
import type { ValidatedDefinition } from '../../../../src/runtime/definition/index.js';
import { AgentManagerError } from '../../../../src/runtime/errors/index.js';
import { AGENT_FAULT_MESSAGES } from '../../../../src/runtime/policy/index.js';
import { buildAgentDefinition } from '../../../support/definition/build-agent-definition.js';
import { FakeInvocationClock } from '../../../support/execution/fake-clock.js';
import { FakeInvocationExecutionPort } from '../../../support/execution/fake-execution-port.js';
import { FakeInvocationOutputPort } from '../../../support/execution/fake-output-port.js';
import { FakeExecutableProbePort } from '../../../support/probe/fake-executable-probe-port.js';

const resultSchema = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const compileCallsFor = (schemaPath: string): number =>
  mocks.compileConsumerSchema.mock.calls.filter(([, path]) => path === schemaPath).length;

const shallowSpreadObject = (value: object): Record<string, unknown> => ({ ...value });

test('reuses compiled effective input validators across starts for the same definition', async () => {
  const definition = buildAgentDefinition({
    parameters: {
      schema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: { model: { type: 'string' } },
        required: ['model'],
        additionalProperties: false,
      },
      defaults: { model: 'default-model' },
    },
    permissions: {
      schema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: { network: { type: 'boolean' } },
        required: ['network'],
        additionalProperties: false,
      },
      defaults: { network: false },
    },
  });
  const [validatedDefinition] = validateManagerOptions({ definitions: [definition] }).definitions;
  if (validatedDefinition === undefined) throw new Error('Expected validated definition');
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  mocks.compileConsumerSchema.mockClear();
  const availableProbe = {
    status: 'available' as const,
    agent: { id: definition.id, version: definition.version },
    definitionDigest: validatedDefinition.definitionDigest,
    executable: '/resolved/fixture-agent',
    reportedVersion: '1.0.0',
  };
  mocks.probeExecutable.mockResolvedValueOnce(availableProbe).mockResolvedValueOnce(availableProbe);
  output.enqueuePrepare();
  output.enqueuePrepare();
  execution.enqueueStart('running');
  execution.enqueueStart('running');
  const manager = createInvocationLifecycleManager(
    { definitions: [definition] },
    {
      execution,
      output,
      clock: new FakeInvocationClock({ initialNowMs: 0 }),
      executableProbe: new FakeExecutableProbePort({ platform: 'linux' }),
      workspace: { admit: async () => ({ status: 'admitted', directory: '/workspace/project' }) },
    },
  );

  const outcomes = await Promise.all(
    ['cached-effective-input-one', 'cached-effective-input-two'].map((invocationId) =>
      manager.start({
        invocationId,
        agent: { id: definition.id, version: definition.version },
        prompt: 'Return JSON.',
        workspace: { directory: '/workspace/project' },
        parameters: {},
        permissions: {},
        result: { schema: resultSchema },
        output: { directory: '/outputs/invocation' },
      }),
    ),
  );

  expect(outcomes.map((outcome) => outcome.status)).toEqual(['accepted', 'accepted']);

  expect(compileCallsFor('/definition/parameters/schema')).toBe(1);
  expect(compileCallsFor('/definition/permissions/schema')).toBe(1);
});

test('rejects effective parameters before workspace, output, and execution when shallow overlay does not deep merge', async () => {
  const definition = buildAgentDefinition({
    parameters: {
      schema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: {
          config: {
            type: 'object',
            required: ['mode'],
            properties: { mode: { type: 'string' }, level: { type: 'integer' } },
            additionalProperties: false,
          },
        },
        required: ['config'],
        additionalProperties: false,
      },
      defaults: { config: { mode: 'default' } },
    },
  });
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  const probe = new FakeExecutableProbePort({ platform: 'linux' });
  const workspace = vi.fn(async () => ({
    status: 'admitted' as const,
    directory: '/workspace/project',
  }));
  const manager = createInvocationLifecycleManager(
    { definitions: [definition] },
    {
      execution,
      output,
      clock: new FakeInvocationClock({ initialNowMs: 0 }),
      executableProbe: probe,
      workspace: { admit: workspace },
    },
  );

  await expect(
    manager.start({
      invocationId: 'invalid-effective-parameters',
      agent: { id: definition.id, version: definition.version },
      prompt: 'Return JSON.',
      workspace: { directory: '/workspace/project' },
      parameters: { config: { level: 1 } },
      permissions: {},
      result: { schema: resultSchema },
      output: { directory: '/outputs/invocation' },
    }),
  ).resolves.toEqual({ status: 'rejected', reason: 'preflight_failed' });

  expect(workspace).not.toHaveBeenCalled();
  expect(probe.calls()).toEqual([]);
  expect(output.calls()).toEqual([]);
  expect(execution.calls()).toEqual([]);
});

test('rejects effective permissions before workspace, output, and execution when caller and defaults violate schema', async () => {
  const definition = buildAgentDefinition({
    permissions: {
      schema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: { mode: { enum: ['read-only'] }, network: { type: 'boolean' } },
        required: ['mode', 'network'],
        additionalProperties: false,
      },
      defaults: { mode: 'read-only', network: false },
    },
  });
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  const probe = new FakeExecutableProbePort({ platform: 'linux' });
  const workspace = vi.fn(async () => ({
    status: 'admitted' as const,
    directory: '/workspace/project',
  }));
  const manager = createInvocationLifecycleManager(
    { definitions: [definition] },
    {
      execution,
      output,
      clock: new FakeInvocationClock({ initialNowMs: 0 }),
      executableProbe: probe,
      workspace: { admit: workspace },
    },
  );

  await expect(
    manager.start({
      invocationId: 'invalid-effective-permissions',
      agent: { id: definition.id, version: definition.version },
      prompt: 'Return JSON.',
      workspace: { directory: '/workspace/project' },
      parameters: {},
      permissions: { network: 'yes' },
      result: { schema: resultSchema },
      output: { directory: '/outputs/invocation' },
    }),
  ).resolves.toEqual({ status: 'rejected', reason: 'preflight_failed' });

  expect(workspace).not.toHaveBeenCalled();
  expect(probe.calls()).toEqual([]);
  expect(output.calls()).toEqual([]);
  expect(execution.calls()).toEqual([]);
});

test('retains package-owned canonical effective parameter and permission copies for launch', async () => {
  const callerParameters = { config: { mode: 'caller' }, nested: ['request'] };
  const callerPermissions = { grants: { write: false }, flags: ['request'] };
  const definition = buildAgentDefinition({
    parameters: {
      schema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: {
          config: {
            type: 'object',
            required: ['mode'],
            properties: { mode: { type: 'string' } },
            additionalProperties: false,
          },
          nested: { type: 'array', items: { type: 'string' } },
        },
        required: ['config', 'nested'],
        additionalProperties: false,
      },
      defaults: { config: { mode: 'default' }, nested: ['default'] },
    },
    permissions: {
      schema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: {
          grants: {
            type: 'object',
            required: ['write'],
            properties: { write: { type: 'boolean' } },
            additionalProperties: false,
          },
          flags: { type: 'array', items: { type: 'string' } },
        },
        required: ['grants', 'flags'],
        additionalProperties: false,
      },
      defaults: { grants: { write: true }, flags: ['default'] },
    },
  });
  const [validatedDefinition] = validateManagerOptions({ definitions: [definition] }).definitions;
  if (validatedDefinition === undefined) throw new Error('Expected validated definition');
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  mocks.probeExecutable.mockResolvedValueOnce({
    status: 'available',
    agent: { id: definition.id, version: definition.version },
    definitionDigest: validatedDefinition.definitionDigest,
    executable: '/resolved/fixture-agent',
    reportedVersion: '1.0.0',
  });
  output.enqueuePrepare();
  execution.enqueueStart('running');
  const manager = createInvocationLifecycleManager(
    { definitions: [definition] },
    {
      execution,
      output,
      clock: new FakeInvocationClock({ initialNowMs: 0 }),
      executableProbe: new FakeExecutableProbePort({ platform: 'linux' }),
      workspace: { admit: async () => ({ status: 'admitted', directory: '/workspace/project' }) },
    },
  );

  const outcome = await manager.start({
    invocationId: 'canonical-effective-inputs',
    agent: { id: definition.id, version: definition.version },
    prompt: 'Return JSON.',
    workspace: { directory: '/workspace/project' },
    parameters: callerParameters,
    permissions: callerPermissions,
    result: { schema: resultSchema },
    output: { directory: '/outputs/invocation' },
  });
  callerParameters.config.mode = 'mutated';
  callerParameters.nested.push('mutated');
  callerPermissions.grants.write = true;
  callerPermissions.flags.push('mutated');

  expect(outcome.status).toBe('accepted');
  expect(execution.startedPreparedLaunches()).toEqual([
    expect.objectContaining({
      effectiveParameters: {
        config: { mode: 'caller' },
        nested: ['request'],
      },
      effectivePermissions: {
        grants: { write: false },
        flags: ['request'],
      },
    }),
  ]);
});

test('rejects mismatched or incomplete available probe evidence before output and execution', async () => {
  const definition = buildAgentDefinition();
  const [validatedDefinition] = validateManagerOptions({ definitions: [definition] }).definitions;
  if (validatedDefinition === undefined) throw new Error('Expected validated definition');
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  const manager = createInvocationLifecycleManager(
    { definitions: [definition] },
    {
      execution,
      output,
      clock: new FakeInvocationClock({ initialNowMs: 0 }),
      executableProbe: new FakeExecutableProbePort({ platform: 'linux' }),
      workspace: { admit: async () => ({ status: 'admitted', directory: '/workspace/project' }) },
    },
  );
  const exactAgent = Object.freeze({ id: definition.id, version: definition.version });
  const exactEvidence = {
    status: 'available' as const,
    agent: exactAgent,
    definitionDigest: validatedDefinition.definitionDigest,
    executable: '/resolved/fixture-agent',
    reportedVersion: '1.0.0',
  };
  mocks.probeExecutable
    .mockResolvedValueOnce({ ...exactEvidence, agent: { ...exactAgent, id: 'other-agent' } })
    .mockResolvedValueOnce({ ...exactEvidence, agent: { ...exactAgent, version: '2.0.0' } })
    .mockResolvedValueOnce({ ...exactEvidence, definitionDigest: 'other-digest' })
    .mockResolvedValueOnce({
      status: 'available',
      agent: exactAgent,
      definitionDigest: validatedDefinition.definitionDigest,
      executable: '/resolved/fixture-agent',
    });

  const outcomes = await Promise.all(
    [
      'mismatched-agent-id',
      'mismatched-agent-version',
      'mismatched-definition-digest',
      'missing-reported-version',
    ].map((invocationId) =>
      manager.start({
        invocationId,
        agent: exactAgent,
        prompt: 'Return JSON.',
        workspace: { directory: '/workspace/project' },
        parameters: {},
        permissions: {},
        result: { schema: resultSchema },
        output: { directory: '/outputs/invocation' },
      }),
    ),
  );
  expect(outcomes).toEqual([
    { status: 'rejected', reason: 'preflight_failed' },
    { status: 'rejected', reason: 'preflight_failed' },
    { status: 'rejected', reason: 'preflight_failed' },
    { status: 'rejected', reason: 'preflight_failed' },
  ]);

  expect(output.calls()).toEqual([]);
  expect(execution.calls()).toEqual([]);
});

test('preclaim binding disagreement rejects before workspace admission', async () => {
  const definition = buildAgentDefinition();
  const workspace = vi.fn(async () => ({
    status: 'admitted' as const,
    directory: '/workspace/project',
  }));
  const createToken = vi
    .spyOn(InstalledBindingRegistry.prototype, 'createBinding')
    .mockImplementationOnce(() => {
      throw new AgentManagerError({
        code: 'revo.agent.internal',
        message: AGENT_FAULT_MESSAGES.internalConstruction,
        phase: 'preflight',
        retryable: false,
      });
    });
  const manager = createInvocationLifecycleManager(
    { definitions: [definition] },
    {
      execution: new FakeInvocationExecutionPort(),
      output: new FakeInvocationOutputPort(),
      clock: new FakeInvocationClock({ initialNowMs: 0 }),
      executableProbe: new FakeExecutableProbePort({ platform: 'linux' }),
      workspace: { admit: workspace },
    },
  );

  await expect(
    manager.start({
      invocationId: 'binding-before-workspace',
      agent: { id: definition.id, version: definition.version },
      prompt: 'Return JSON.',
      workspace: { directory: '/workspace/project' },
      parameters: {},
      permissions: {},
      result: { schema: resultSchema },
      output: { directory: '/outputs/invocation' },
    }),
  ).rejects.toMatchObject({
    fault: { code: 'revo.agent.internal', phase: 'preflight' },
  });

  expect(createToken).toHaveBeenCalledTimes(1);
  expect(workspace).not.toHaveBeenCalled();
  createToken.mockRestore();
});

test('rejects coherent but uninstalled package bindings during manager construction', () => {
  const claudeDefinition = buildAgentDefinition({
    protocol: {
      driver: 'native/stdio-v1',
      resultParser: 'claude-stream-json/v1',
      permissionStrategy: 'claude-cli/v1',
    },
  });
  const { constraints: _constraints, ...acpDefinition } = buildAgentDefinition({
    protocol: { driver: 'acp/v1', permissionStrategy: 'acp/v1' },
    delivery: { prompt: 'protocol', resultSchema: 'protocol', result: 'protocol' },
    launch: {
      command: '/fixture/bin/acp-agent',
      args: [],
      versionProbe: { args: ['--version'], stream: 'stdout', timeoutMs: 1_000 },
    },
  });

  for (const definition of [claudeDefinition, acpDefinition]) {
    expect(() =>
      createInvocationLifecycleManager(
        { definitions: [definition] },
        {
          execution: new FakeInvocationExecutionPort(),
          output: new FakeInvocationOutputPort(),
          clock: new FakeInvocationClock({ initialNowMs: 0 }),
          executableProbe: new FakeExecutableProbePort({ platform: 'linux' }),
          workspace: {
            admit: async () => ({ status: 'admitted', directory: '/workspace/project' }),
          },
        },
      ),
    ).toThrowError(AgentManagerError);
    try {
      createInvocationLifecycleManager(
        { definitions: [definition] },
        {
          execution: new FakeInvocationExecutionPort(),
          output: new FakeInvocationOutputPort(),
          clock: new FakeInvocationClock({ initialNowMs: 0 }),
          executableProbe: new FakeExecutableProbePort({ platform: 'linux' }),
          workspace: {
            admit: async () => ({ status: 'admitted', directory: '/workspace/project' }),
          },
        },
      );
      throw new Error('Expected installed binding rejection.');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(AgentManagerError);
      if (!(error instanceof AgentManagerError)) throw error;
      expect(error.fault).toEqual({
        code: 'revo.agent.strategy_unsupported',
        message: AGENT_FAULT_MESSAGES.strategyUnsupported,
        phase: 'construction',
        retryable: false,
      });
    }
  }
});

test('preclaim binding defense fails internal when the sealed target disagrees with construction', () => {
  const definition = buildAgentDefinition();
  const [validatedDefinition] = validateManagerOptions({ definitions: [definition] }).definitions;
  if (validatedDefinition === undefined) throw new Error('Expected validated definition');
  const registry = InstalledBindingRegistry.create([validatedDefinition]);
  const disagreedTarget: ValidatedDefinition = Object.freeze({
    definition: Object.freeze({
      ...validatedDefinition.definition,
      protocol: Object.freeze({
        driver: 'native/stdio-v1',
        resultParser: 'claude-stream-json/v1',
        permissionStrategy: 'claude-cli/v1',
      }),
    }),
    definitionDigest: validatedDefinition.definitionDigest,
  });

  try {
    registry.createBinding(disagreedTarget);
    throw new Error('Expected preclaim installed-binding disagreement.');
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(AgentManagerError);
    if (!(error instanceof AgentManagerError)) throw error;
    expect(error.fault).toEqual({
      code: 'revo.agent.internal',
      message: AGENT_FAULT_MESSAGES.internalConstruction,
      phase: 'preflight',
      retryable: false,
    });
  }
});

test('captures named child environment from start context before workspace, output, and execution', async () => {
  vi.stubEnv('REVO_VISIBLE_ENV', 'host-value');
  const definition = buildAgentDefinition();
  const [validatedDefinition] = validateManagerOptions({ definitions: [definition] }).definitions;
  if (validatedDefinition === undefined) throw new Error('Expected validated definition');
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  mocks.probeExecutable.mockResolvedValueOnce({
    status: 'available',
    agent: { id: definition.id, version: definition.version },
    definitionDigest: validatedDefinition.definitionDigest,
    executable: '/resolved/fixture-agent',
    reportedVersion: '1.0.0',
  });
  output.enqueuePrepare();
  execution.enqueueStart('running');
  const manager = createInvocationLifecycleManager(
    { definitions: [definition], redaction: { secrets: ['configured-secret'] } },
    {
      execution,
      output,
      clock: new FakeInvocationClock({ initialNowMs: 0 }),
      executableProbe: new FakeExecutableProbePort({ platform: 'linux' }),
      workspace: { admit: async () => ({ status: 'admitted', directory: '/workspace/project' }) },
    },
  );
  const context = {
    environment: {
      inherit: ['REVO_VISIBLE_ENV'],
      variables: { REVO_EXPLICIT_ENV: 'explicit-value' },
      secrets: { REVO_SECRET_ENV: 'secret-value' },
    },
  };

  const outcome = await manager.start(
    {
      invocationId: 'captured-child-environment',
      agent: { id: definition.id, version: definition.version },
      prompt: 'Return JSON.',
      workspace: { directory: '/workspace/project' },
      parameters: {},
      permissions: {},
      result: { schema: resultSchema },
      output: { directory: '/outputs/invocation' },
    },
    context,
  );
  context.environment.inherit.push('MUTATED_AFTER_START');
  context.environment.variables.REVO_EXPLICIT_ENV = 'mutated';
  context.environment.secrets.REVO_SECRET_ENV = 'mutated-secret';

  expect(outcome.status).toBe('accepted');
  const [prepared] = execution.startedPreparedLaunches();
  expect(prepared).toMatchObject({
    childEnvironment: {
      REVO_VISIBLE_ENV: 'host-value',
      REVO_EXPLICIT_ENV: 'explicit-value',
      REVO_SECRET_ENV: 'secret-value',
    },
  });
  expect(prepared?.childEnvironmentSecretValues).toEqual(['secret-value']);
  expect(prepared?.secretValues).toEqual(['configured-secret', 'secret-value']);
});

test('keeps registered secrets out of enumerable launch views', async () => {
  vi.stubEnv('REVO_VISIBLE_ENV', 'host-value');
  const definition = buildAgentDefinition();
  const [validatedDefinition] = validateManagerOptions({ definitions: [definition] }).definitions;
  if (validatedDefinition === undefined) throw new Error('Expected validated definition');
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  mocks.probeExecutable.mockResolvedValueOnce({
    status: 'available',
    agent: { id: definition.id, version: definition.version },
    definitionDigest: validatedDefinition.definitionDigest,
    executable: '/resolved/fixture-agent',
    reportedVersion: '1.0.0',
  });
  output.enqueuePrepare();
  execution.enqueueStart('running');
  const manager = createInvocationLifecycleManager(
    { definitions: [definition], redaction: { secrets: ['configured-secret'] } },
    {
      execution,
      output,
      clock: new FakeInvocationClock({ initialNowMs: 0 }),
      executableProbe: new FakeExecutableProbePort({ platform: 'linux' }),
      workspace: { admit: async () => ({ status: 'admitted', directory: '/workspace/project' }) },
    },
  );

  const outcome = await manager.start(
    {
      invocationId: 'non-enumerable-child-environment',
      agent: { id: definition.id, version: definition.version },
      prompt: 'Return JSON.',
      workspace: { directory: '/workspace/project' },
      parameters: {},
      permissions: {},
      result: { schema: resultSchema },
      output: { directory: '/outputs/invocation' },
    },
    {
      environment: {
        inherit: ['REVO_VISIBLE_ENV'],
        variables: { REVO_EXPLICIT_ENV: 'explicit-value' },
        secrets: { REVO_SECRET_ENV: 'secret-value' },
      },
    },
  );

  expect(outcome.status).toBe('accepted');
  const [prepared] = execution.startedPreparedLaunches();
  if (prepared === undefined) throw new Error('Expected prepared launch evidence');

  expect(prepared.childEnvironment.REVO_SECRET_ENV).toBe('secret-value');
  expect(Object.getOwnPropertyDescriptor(prepared, 'secretValues')).toMatchObject({
    enumerable: false,
    writable: false,
    configurable: false,
  });
  expect(prepared.secretValues).toEqual(['configured-secret', 'secret-value']);
  const enumerableViews = [
    Object.keys(prepared).join('\n'),
    JSON.stringify(shallowSpreadObject(prepared)),
    JSON.stringify(prepared),
  ];
  for (const view of enumerableViews) {
    expect(view).not.toContain('REVO_SECRET_ENV');
    expect(view).not.toContain('configured-secret');
    expect(view).not.toContain('secret-value');
  }
});

test('keeps configured redaction secrets out of enumerable manager views', () => {
  const definition = buildAgentDefinition();
  const manager = createInvocationLifecycleManager(
    { definitions: [definition], redaction: { secrets: ['configured-secret'] } },
    {
      execution: new FakeInvocationExecutionPort(),
      output: new FakeInvocationOutputPort(),
      clock: new FakeInvocationClock({ initialNowMs: 0 }),
      executableProbe: new FakeExecutableProbePort({ platform: 'linux' }),
    },
  );

  const enumerableViews = [
    Object.keys(manager).join('\n'),
    JSON.stringify(shallowSpreadObject(manager)),
    JSON.stringify(manager),
  ];
  for (const view of enumerableViews) {
    expect(view).not.toContain('configured-secret');
  }
});

test('rejects registered secret failures before workspace, output, and execution', async () => {
  const definition = buildAgentDefinition();
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  const probe = new FakeExecutableProbePort({ platform: 'linux' });
  const workspace = vi.fn(async () => ({
    status: 'admitted' as const,
    directory: '/workspace/project',
  }));
  const manager = createInvocationLifecycleManager(
    { definitions: [definition], redaction: { secrets: [''] } },
    {
      execution,
      output,
      clock: new FakeInvocationClock({ initialNowMs: 0 }),
      executableProbe: probe,
      workspace: { admit: workspace },
    },
  );

  await expect(
    manager.start({
      invocationId: 'invalid-registered-secrets',
      agent: { id: definition.id, version: definition.version },
      prompt: 'Return JSON.',
      workspace: { directory: '/workspace/project' },
      parameters: {},
      permissions: {},
      result: { schema: resultSchema },
      output: { directory: '/outputs/invocation' },
    }),
  ).resolves.toEqual({ status: 'rejected', reason: 'preflight_failed' });

  expect(workspace).not.toHaveBeenCalled();
  expect(probe.calls()).toEqual([]);
  expect(output.calls()).toEqual([]);
  expect(execution.calls()).toEqual([]);
});

test('rejects missing inherited child environment names before workspace, output, and execution', async () => {
  vi.stubEnv('REVO_MISSING_ENV', undefined);
  const definition = buildAgentDefinition();
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  const probe = new FakeExecutableProbePort({ platform: 'linux' });
  const workspace = vi.fn(async () => ({
    status: 'admitted' as const,
    directory: '/workspace/project',
  }));
  const manager = createInvocationLifecycleManager(
    { definitions: [definition] },
    {
      execution,
      output,
      clock: new FakeInvocationClock({ initialNowMs: 0 }),
      executableProbe: probe,
      workspace: { admit: workspace },
    },
  );

  await expect(
    manager.start(
      {
        invocationId: 'missing-child-environment',
        agent: { id: definition.id, version: definition.version },
        prompt: 'Return JSON.',
        workspace: { directory: '/workspace/project' },
        parameters: {},
        permissions: {},
        result: { schema: resultSchema },
        output: { directory: '/outputs/invocation' },
      },
      { environment: { inherit: ['REVO_MISSING_ENV'] } },
    ),
  ).resolves.toEqual({ status: 'rejected', reason: 'preflight_failed' });

  expect(workspace).not.toHaveBeenCalled();
  expect(probe.calls()).toEqual([]);
  expect(output.calls()).toEqual([]);
  expect(execution.calls()).toEqual([]);
});

test('rejects malformed start context before reserving invocation ids', async () => {
  const definition = buildAgentDefinition();
  const manager = createInvocationLifecycleManager(
    { definitions: [definition] },
    {
      execution: new FakeInvocationExecutionPort(),
      output: new FakeInvocationOutputPort(),
      clock: new FakeInvocationClock({ initialNowMs: 0 }),
      executableProbe: new FakeExecutableProbePort({ platform: 'linux' }),
      workspace: { admit: async () => ({ status: 'admitted', directory: '/workspace/project' }) },
    },
  );
  const context = { environment: { inherit: ['REVO_ALLOWED_ENV'] }, extra: true };

  await expect(
    manager.start(
      {
        invocationId: 'malformed-start-context',
        agent: { id: definition.id, version: definition.version },
        prompt: 'Return JSON.',
        workspace: { directory: '/workspace/project' },
        parameters: {},
        permissions: {},
        result: { schema: resultSchema },
        output: { directory: '/outputs/invocation' },
      },
      context,
    ),
  ).resolves.toEqual({ status: 'rejected', reason: 'invalid_request' });

  await expect(
    manager.start({
      invocationId: 'malformed-start-context',
      agent: { id: 'unknown-agent', version: definition.version },
      prompt: 'Return JSON.',
      workspace: { directory: '/workspace/project' },
      parameters: {},
      permissions: {},
      result: { schema: resultSchema },
      output: { directory: '/outputs/invocation' },
    }),
  ).resolves.toEqual({ status: 'rejected', reason: 'preflight_failed' });
});
