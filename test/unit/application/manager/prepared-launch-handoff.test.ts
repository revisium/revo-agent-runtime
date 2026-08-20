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
import { FakeOutputClaimPort } from '../../../support/execution/fake-output-claim-port.js';
import { FakeInvocationOutputPort } from '../../../support/execution/fake-output-port.js';
import { FakeOutputPreparationPort } from '../../../support/execution/fake-output-preparation-port.js';
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
  execution.enqueueStart('running');
  execution.enqueueStart('running');
  const manager = createInvocationLifecycleManager(
    { definitions: [definition] },
    {
      execution,
      output,
      clock: new FakeInvocationClock({ initialNowMs: 0 }),
      outputClaim: new FakeOutputClaimPort('created'),
      outputPreparation: new FakeOutputPreparationPort('prepared'),
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
      outputClaim: new FakeOutputClaimPort('created'),
      outputPreparation: new FakeOutputPreparationPort('prepared'),
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
      outputClaim: new FakeOutputClaimPort('created'),
      outputPreparation: new FakeOutputPreparationPort('prepared'),
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
  execution.enqueueStart('running');
  const manager = createInvocationLifecycleManager(
    { definitions: [definition] },
    {
      execution,
      output,
      clock: new FakeInvocationClock({ initialNowMs: 0 }),
      outputClaim: new FakeOutputClaimPort('created'),
      outputPreparation: new FakeOutputPreparationPort('prepared'),
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

test('plans output resources after workspace admission and before executable probe', async () => {
  const definition = buildAgentDefinition({
    delivery: { prompt: 'file', resultSchema: 'file', result: 'stdout' },
    launch: {
      command: '/fixture/bin/agent',
      args: [{ kind: 'prompt-file' }, { kind: 'result-schema-file' }],
      versionProbe: { args: ['--version'], stream: 'stdout', prefix: 'agent ', timeoutMs: 1_000 },
    },
  });
  const [validatedDefinition] = validateManagerOptions({ definitions: [definition] }).definitions;
  if (validatedDefinition === undefined) throw new Error('Expected validated definition');
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  const calls: string[] = [];
  const workspace = vi.fn(async () => {
    calls.push('workspace');
    return { status: 'admitted' as const, directory: '/workspace/project' };
  });
  output.enqueueAdmission(() => {
    calls.push('output-admission');
    return {
      status: 'admitted' as const,
      plan: {
        invocationId: 'output-resource-plan',
        outputDirectory: '/outputs/invocation',
        needsPromptFile: true,
        needsResultSchemaFile: true,
      },
    };
  });
  mocks.probeExecutable.mockImplementationOnce(async () => {
    calls.push('probe');
    return {
      status: 'available' as const,
      agent: { id: definition.id, version: definition.version },
      definitionDigest: validatedDefinition.definitionDigest,
      executable: '/resolved/fixture-agent',
      reportedVersion: '1.0.0',
    };
  });
  execution.enqueueStart('running');
  const manager = createInvocationLifecycleManager(
    { definitions: [definition] },
    {
      execution,
      output,
      clock: new FakeInvocationClock({ initialNowMs: 0 }),
      outputClaim: new FakeOutputClaimPort('created'),
      outputPreparation: new FakeOutputPreparationPort('prepared'),
      executableProbe: new FakeExecutableProbePort({ platform: 'linux' }),
      workspace: { admit: workspace },
    },
  );

  const outcome = await manager.start({
    invocationId: 'output-resource-plan',
    agent: { id: definition.id, version: definition.version },
    prompt: 'Return JSON.',
    workspace: { directory: '/workspace/project' },
    parameters: {},
    permissions: {},
    result: { schema: resultSchema },
    output: { directory: '/outputs/invocation' },
  });

  expect(outcome.status).toBe('accepted');
  expect(calls).toEqual(['workspace', 'output-admission', 'probe']);
  expect(output.calls()).toEqual([
    {
      type: 'admit',
      request: {
        invocationId: 'output-resource-plan',
        outputDirectory: '/outputs/invocation',
        needsPromptFile: true,
        needsResultSchemaFile: true,
      },
    },
  ]);
  expect(execution.startedPreparedLaunches()).toEqual([
    expect.objectContaining({
      outputResourcePlan: {
        invocationId: 'output-resource-plan',
        outputDirectory: '/outputs/invocation',
        needsPromptFile: true,
        needsResultSchemaFile: true,
      },
    }),
  ]);
});

test('rejects output admission failures before executable probe, output prepare, and execution', async () => {
  const definition = buildAgentDefinition({
    delivery: { prompt: 'stdin', resultSchema: 'argument', result: 'stdout' },
    launch: {
      command: '/fixture/bin/agent',
      args: [{ kind: 'result-schema' }],
      versionProbe: { args: ['--version'], stream: 'stdout', prefix: 'agent ', timeoutMs: 1_000 },
    },
  });
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  const probe = new FakeExecutableProbePort({ platform: 'linux' });
  const workspace = vi.fn(async () => ({
    status: 'admitted' as const,
    directory: '/workspace/project',
  }));
  output.enqueueAdmission({ status: 'rejected', reason: 'leaf_exists' });
  const manager = createInvocationLifecycleManager(
    { definitions: [definition] },
    {
      execution,
      output,
      clock: new FakeInvocationClock({ initialNowMs: 0 }),
      outputClaim: new FakeOutputClaimPort('created'),
      outputPreparation: new FakeOutputPreparationPort('prepared'),
      executableProbe: probe,
      workspace: { admit: workspace },
    },
  );

  await expect(
    manager.start({
      invocationId: 'inadmissible-output',
      agent: { id: definition.id, version: definition.version },
      prompt: 'Return JSON.',
      workspace: { directory: '/workspace/project' },
      parameters: {},
      permissions: {},
      result: { schema: resultSchema },
      output: { directory: '/outputs/invocation' },
    }),
  ).resolves.toEqual({ status: 'rejected', reason: 'preflight_failed' });

  expect(workspace).toHaveBeenCalledTimes(1);
  expect(output.calls()).toEqual([
    {
      type: 'admit',
      request: {
        invocationId: 'inadmissible-output',
        outputDirectory: '/outputs/invocation',
        needsPromptFile: false,
        needsResultSchemaFile: false,
      },
    },
  ]);
  expect(probe.calls()).toEqual([]);
  expect(execution.calls()).toEqual([]);
});

test('rejects mismatched or incomplete available probe evidence after output admission and before prepare and execution', async () => {
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
      outputClaim: new FakeOutputClaimPort('created'),
      outputPreparation: new FakeOutputPreparationPort('prepared'),
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

  expect(output.calls()).toEqual(
    [
      'mismatched-agent-id',
      'mismatched-agent-version',
      'mismatched-definition-digest',
      'missing-reported-version',
    ].map((invocationId) => ({
      type: 'admit' as const,
      request: {
        invocationId,
        outputDirectory: '/outputs/invocation',
        needsPromptFile: false,
        needsResultSchemaFile: false,
      },
    })),
  );
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
      outputClaim: new FakeOutputClaimPort('created'),
      outputPreparation: new FakeOutputPreparationPort('prepared'),
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
          outputClaim: new FakeOutputClaimPort('created'),
          outputPreparation: new FakeOutputPreparationPort('prepared'),
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
          outputClaim: new FakeOutputClaimPort('created'),
          outputPreparation: new FakeOutputPreparationPort('prepared'),
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
  execution.enqueueStart('running');
  const manager = createInvocationLifecycleManager(
    { definitions: [definition], redaction: { secrets: ['configured-secret'] } },
    {
      execution,
      output,
      clock: new FakeInvocationClock({ initialNowMs: 0 }),
      outputClaim: new FakeOutputClaimPort('created'),
      outputPreparation: new FakeOutputPreparationPort('prepared'),
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
  execution.enqueueStart('running');
  const manager = createInvocationLifecycleManager(
    { definitions: [definition], redaction: { secrets: ['configured-secret'] } },
    {
      execution,
      output,
      clock: new FakeInvocationClock({ initialNowMs: 0 }),
      outputClaim: new FakeOutputClaimPort('created'),
      outputPreparation: new FakeOutputPreparationPort('prepared'),
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
      outputClaim: new FakeOutputClaimPort('created'),
      outputPreparation: new FakeOutputPreparationPort('prepared'),
      executableProbe: new FakeExecutableProbePort({ platform: 'linux' }),
      workspace: {
        admit: async () =>
          Object.freeze({ status: 'admitted' as const, directory: '/workspace/project' }),
      },
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
      outputClaim: new FakeOutputClaimPort('created'),
      outputPreparation: new FakeOutputPreparationPort('prepared'),
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
      outputClaim: new FakeOutputClaimPort('created'),
      outputPreparation: new FakeOutputPreparationPort('prepared'),
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
      outputClaim: new FakeOutputClaimPort('created'),
      outputPreparation: new FakeOutputPreparationPort('prepared'),
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

test('interprets launch template in definition order and maps each permission item once before probe', async () => {
  const definition = buildAgentDefinition({
    launch: {
      command: '/fixture/bin/agent',
      args: [
        { kind: 'literal', value: 'exec' },
        { kind: 'workspace' },
        { kind: 'parameter', name: 'model' },
        { kind: 'parameter', name: 'options' },
        { kind: 'permission', name: 'mode' },
        { kind: 'permission', name: 'network' },
        { kind: 'prompt' },
        { kind: 'result-schema-file' },
      ],
      versionProbe: { args: ['--version'], stream: 'stdout', prefix: 'agent ', timeoutMs: 1_000 },
    },
    delivery: { prompt: 'argument', resultSchema: 'file', result: 'stdout' },
    parameters: {
      schema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: {
          model: { type: 'string' },
          options: {
            type: 'object',
            properties: { temperature: { type: 'number' } },
            required: ['temperature'],
            additionalProperties: false,
          },
        },
        required: ['model', 'options'],
        additionalProperties: false,
      },
    },
    permissions: {
      schema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: { mode: { enum: ['workspace-write'] }, network: { type: 'boolean' } },
        required: ['mode', 'network'],
        additionalProperties: false,
      },
    },
  });
  const [validatedDefinition] = validateManagerOptions({ definitions: [definition] }).definitions;
  if (validatedDefinition === undefined) throw new Error('Expected validated definition');
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  const calls: string[] = [];
  const workspace = vi.fn(async () => {
    calls.push('workspace');
    return { status: 'admitted' as const, directory: '/workspace/project' };
  });
  output.enqueueAdmission(() => {
    calls.push('output-admission');
    return {
      status: 'admitted' as const,
      plan: {
        invocationId: 'interpreted-template',
        outputDirectory: '/outputs/invocation',
        needsPromptFile: false,
        needsResultSchemaFile: true,
      },
    };
  });
  mocks.probeExecutable.mockImplementationOnce(async () => {
    calls.push('probe');
    return {
      status: 'available' as const,
      agent: { id: definition.id, version: definition.version },
      definitionDigest: validatedDefinition.definitionDigest,
      executable: '/resolved/fixture-agent',
      reportedVersion: '1.0.0',
    };
  });
  execution.enqueueStart('running');
  const manager = createInvocationLifecycleManager(
    { definitions: [definition] },
    {
      execution,
      output,
      clock: new FakeInvocationClock({ initialNowMs: 0 }),
      outputClaim: new FakeOutputClaimPort('created'),
      outputPreparation: new FakeOutputPreparationPort('prepared'),
      executableProbe: new FakeExecutableProbePort({ platform: 'linux' }),
      workspace: { admit: workspace },
    },
  );

  const outcome = await manager.start({
    invocationId: 'interpreted-template',
    agent: { id: definition.id, version: definition.version },
    prompt: 'Return JSON.',
    workspace: { directory: '/workspace/project' },
    parameters: { model: 'gpt-5', options: { temperature: 0 } },
    permissions: { mode: 'workspace-write', network: false },
    result: { schema: resultSchema },
    output: { directory: '/outputs/invocation' },
  });

  expect(outcome.status).toBe('accepted');
  expect(calls).toEqual(['workspace', 'output-admission', 'probe']);
  expect(execution.startedPreparedLaunches()).toEqual([
    expect.objectContaining({
      interpretedArgumentTemplate: [
        { kind: 'arguments', arguments: ['exec'] },
        { kind: 'arguments', arguments: ['/workspace/project'] },
        { kind: 'arguments', arguments: ['gpt-5'] },
        { kind: 'arguments', arguments: ['{"temperature":0}'] },
        { kind: 'arguments', arguments: ['--sandbox=workspace-write', '--ask-for-approval=never'] },
        {
          kind: 'arguments',
          arguments: ['--config', 'sandbox_workspace_write.network_access=false'],
        },
        { kind: 'prompt' },
        { kind: 'result-schema-file' },
      ],
    }),
  ]);
});

test('rejects permission mapping failures before executable probe, output prepare, and execution', async () => {
  const definition = buildAgentDefinition({
    launch: {
      command: '/fixture/bin/agent',
      args: [{ kind: 'permission', name: 'mode' }, { kind: 'prompt' }, { kind: 'result-schema' }],
      versionProbe: { args: ['--version'], stream: 'stdout', prefix: 'agent ', timeoutMs: 1_000 },
    },
    permissions: {
      schema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: { mode: { enum: ['read-only'] }, network: { const: true } },
        required: ['mode', 'network'],
        additionalProperties: false,
      },
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
      outputClaim: new FakeOutputClaimPort('created'),
      outputPreparation: new FakeOutputPreparationPort('prepared'),
      executableProbe: probe,
      workspace: { admit: workspace },
    },
  );

  await expect(
    manager.start({
      invocationId: 'permission-mapping-rejected',
      agent: { id: definition.id, version: definition.version },
      prompt: 'Return JSON.',
      workspace: { directory: '/workspace/project' },
      parameters: {},
      permissions: { mode: 'read-only', network: true },
      result: { schema: resultSchema },
      output: { directory: '/outputs/invocation' },
    }),
  ).resolves.toEqual({ status: 'rejected', reason: 'preflight_failed' });

  expect(workspace).toHaveBeenCalledTimes(1);
  expect(output.calls()).toEqual([
    {
      type: 'admit',
      request: {
        invocationId: 'permission-mapping-rejected',
        outputDirectory: '/outputs/invocation',
        needsPromptFile: false,
        needsResultSchemaFile: false,
      },
    },
  ]);
  expect(probe.calls()).toEqual([]);
  expect(execution.calls()).toEqual([]);
});

test('retains resolved prompt stdin and canonical result-schema file payloads before output prepare', async () => {
  const definition = buildAgentDefinition({
    delivery: { prompt: 'stdin', resultSchema: 'file', result: 'stdout' },
    launch: {
      command: '/fixture/bin/agent',
      args: [{ kind: 'literal', value: 'exec' }, { kind: 'result-schema-file' }],
      versionProbe: { args: ['--version'], stream: 'stdout', prefix: 'agent ', timeoutMs: 1_000 },
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
  execution.enqueueStart('running');
  const manager = createInvocationLifecycleManager(
    { definitions: [definition] },
    {
      execution,
      output,
      clock: new FakeInvocationClock({ initialNowMs: 0 }),
      outputClaim: new FakeOutputClaimPort('created'),
      outputPreparation: new FakeOutputPreparationPort('prepared'),
      executableProbe: new FakeExecutableProbePort({ platform: 'linux' }),
      workspace: { admit: async () => ({ status: 'admitted', directory: '/workspace/project' }) },
    },
  );

  const outcome = await manager.start({
    invocationId: 'prepared-payloads',
    agent: { id: definition.id, version: definition.version },
    prompt: 'Return JSON.',
    workspace: { directory: '/workspace/project' },
    parameters: {},
    permissions: {},
    result: { schema: { type: 'object', $schema: 'https://json-schema.org/draft/2020-12/schema' } },
    output: { directory: '/outputs/invocation' },
  });

  expect(outcome.status).toBe('accepted');
  expect(execution.startedPreparedLaunches()).toEqual([
    expect.objectContaining({
      preparedPayloads: {
        arguments: ['exec'],
        stdin: new TextEncoder().encode('Return JSON.'),
        files: [
          {
            kind: 'result-schema',
            path: '/outputs/invocation/.scratch/result-schema.json',
            bytes: new TextEncoder().encode(
              '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object"}',
            ),
          },
        ],
      },
    }),
  ]);
});

test('rejects prospective argv total bytes including the resolved executable before output prepare and execution', async () => {
  const definition = buildAgentDefinition({
    launch: {
      command: '/fixture/bin/agent',
      args: [{ kind: 'prompt' }, { kind: 'result-schema-file' }],
      versionProbe: { args: ['--version'], stream: 'stdout', prefix: 'agent ', timeoutMs: 1_000 },
    },
    delivery: { prompt: 'argument', resultSchema: 'file', result: 'stdout' },
  });
  const [validatedDefinition] = validateManagerOptions({ definitions: [definition] }).definitions;
  if (validatedDefinition === undefined) throw new Error('Expected validated definition');
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  const calls: string[] = [];
  mocks.probeExecutable.mockImplementationOnce(async () => {
    calls.push('probe');
    return {
      status: 'available' as const,
      agent: { id: definition.id, version: definition.version },
      definitionDigest: validatedDefinition.definitionDigest,
      executable: '/resolved/fixture-agent',
      reportedVersion: '1.0.0',
    };
  });
  output.enqueueAdmission(() => {
    calls.push('output-admission');
    return {
      status: 'admitted' as const,
      plan: {
        invocationId: 'oversized-prospective-argv',
        outputDirectory: '/outputs/invocation',
        needsPromptFile: false,
        needsResultSchemaFile: true,
      },
    };
  });
  const manager = createInvocationLifecycleManager(
    { definitions: [definition] },
    {
      execution,
      output,
      clock: new FakeInvocationClock({ initialNowMs: 0 }),
      outputClaim: new FakeOutputClaimPort('created'),
      outputPreparation: new FakeOutputPreparationPort('prepared'),
      executableProbe: new FakeExecutableProbePort({ platform: 'linux' }),
      workspace: { admit: async () => ({ status: 'admitted', directory: '/workspace/project' }) },
    },
  );

  await expect(
    manager.start({
      invocationId: 'oversized-prospective-argv',
      agent: { id: definition.id, version: definition.version },
      prompt: 'x'.repeat(1_048_576),
      workspace: { directory: '/workspace/project' },
      parameters: {},
      permissions: {},
      result: { schema: resultSchema },
      output: { directory: '/outputs/invocation' },
    }),
  ).resolves.toEqual({ status: 'rejected', reason: 'preflight_failed' });

  expect(calls).toEqual(['output-admission', 'probe']);
  expect(output.calls()).toEqual([
    {
      type: 'admit',
      request: {
        invocationId: 'oversized-prospective-argv',
        outputDirectory: '/outputs/invocation',
        needsPromptFile: false,
        needsResultSchemaFile: true,
      },
    },
  ]);
  expect(execution.calls()).toEqual([]);
});

test('rejects registered secret byte substrings in prospective argv with environment invalid', async () => {
  const definition = buildAgentDefinition({
    launch: {
      command: '/fixture/bin/agent',
      args: [
        { kind: 'literal', value: 'prefix-secret-value-suffix' },
        { kind: 'result-schema-file' },
      ],
      versionProbe: { args: ['--version'], stream: 'stdout', prefix: 'agent ', timeoutMs: 1_000 },
    },
    delivery: { prompt: 'stdin', resultSchema: 'file', result: 'stdout' },
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
  const manager = createInvocationLifecycleManager(
    { definitions: [definition], redaction: { secrets: ['secret-value'] } },
    {
      execution,
      output,
      clock: new FakeInvocationClock({ initialNowMs: 0 }),
      outputClaim: new FakeOutputClaimPort('created'),
      outputPreparation: new FakeOutputPreparationPort('prepared'),
      executableProbe: new FakeExecutableProbePort({ platform: 'linux' }),
      workspace: { admit: async () => ({ status: 'admitted', directory: '/workspace/project' }) },
    },
  );

  await expect(
    manager.start({
      invocationId: 'secret-argv-rejected',
      agent: { id: definition.id, version: definition.version },
      prompt: 'Return JSON.',
      workspace: { directory: '/workspace/project' },
      parameters: {},
      permissions: {},
      result: { schema: resultSchema },
      output: { directory: '/outputs/invocation' },
    }),
  ).resolves.toEqual({ status: 'rejected', reason: 'environment_invalid' });

  expect(output.calls()).toEqual([
    {
      type: 'admit',
      request: {
        invocationId: 'secret-argv-rejected',
        outputDirectory: '/outputs/invocation',
        needsPromptFile: false,
        needsResultSchemaFile: true,
      },
    },
  ]);
  expect(execution.calls()).toEqual([]);
});

test('rejects registered secret byte substrings in prospective scratch payloads with environment invalid', async () => {
  const definition = buildAgentDefinition({
    launch: {
      command: '/fixture/bin/agent',
      args: [{ kind: 'prompt-file' }, { kind: 'result-schema' }],
      versionProbe: { args: ['--version'], stream: 'stdout', prefix: 'agent ', timeoutMs: 1_000 },
    },
    delivery: { prompt: 'file', resultSchema: 'argument', result: 'stdout' },
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
  const manager = createInvocationLifecycleManager(
    { definitions: [definition], redaction: { secrets: ['secret-value'] } },
    {
      execution,
      output,
      clock: new FakeInvocationClock({ initialNowMs: 0 }),
      outputClaim: new FakeOutputClaimPort('created'),
      outputPreparation: new FakeOutputPreparationPort('prepared'),
      executableProbe: new FakeExecutableProbePort({ platform: 'linux' }),
      workspace: { admit: async () => ({ status: 'admitted', directory: '/workspace/project' }) },
    },
  );

  await expect(
    manager.start({
      invocationId: 'secret-scratch-payload-rejected',
      agent: { id: definition.id, version: definition.version },
      prompt: 'prefix-secret-value-suffix',
      workspace: { directory: '/workspace/project' },
      parameters: {},
      permissions: {},
      result: { schema: resultSchema },
      output: { directory: '/outputs/invocation' },
    }),
  ).resolves.toEqual({ status: 'rejected', reason: 'environment_invalid' });

  expect(output.calls()).toEqual([
    {
      type: 'admit',
      request: {
        invocationId: 'secret-scratch-payload-rejected',
        outputDirectory: '/outputs/invocation',
        needsPromptFile: true,
        needsResultSchemaFile: false,
      },
    },
  ]);
  expect(execution.calls()).toEqual([]);
});
