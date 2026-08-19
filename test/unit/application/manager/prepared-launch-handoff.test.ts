import { expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ probeExecutable: vi.fn() }));

vi.mock('../../../../src/runtime/probe/index.js', () => ({
  probeExecutable: mocks.probeExecutable,
}));

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
