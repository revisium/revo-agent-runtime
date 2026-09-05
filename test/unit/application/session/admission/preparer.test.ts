import { expect, test, vi } from 'vitest';

import { createSessionOpeningPreparer } from '../../../../../src/application/session/admission/preparer.js';
import type { AgentDefinition } from '../../../../../src/contracts/agent-definition.js';
import type { ValidatedAgentDefinition } from '../../../../../src/definition/index.js';
import type { OutputClaimPlatform } from '../../../../../src/execution/output/claim.js';
import type { SessionOutputPublicationTarget } from '../../../../../src/execution/output/session/publication.js';
import type { ExecutablePreflight } from '../../../../../src/execution/probe/executable-preflight.js';
import type { SessionOpeningDescriptor } from '../../../../../src/execution/session/kernel/model/opening-state.js';
import { agentDefinition } from '../../../../support/builders/agent-definition.js';
import { sessionOpeningCommand } from '../../../../support/session/builders/kernel/opening.js';

const definition = agentDefinition({
  parameters: {
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      properties: { model: { type: 'string' } },
      required: ['model'],
      type: 'object',
    },
  },
  permissions: {
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      properties: { write: { type: 'boolean' } },
      required: ['write'],
      type: 'object',
    },
  },
}) as AgentDefinition;

const validated = (value: AgentDefinition = definition): ValidatedAgentDefinition => ({
  canonicalBytes: () => new Uint8Array(),
  definition: value,
  digest: 'digest',
});

const opening = (overrides: Partial<SessionOpeningDescriptor> = {}): SessionOpeningDescriptor => {
  const base = sessionOpeningCommand().opening;
  return {
    ...base,
    pin: { agentId: definition.id, agentVersion: definition.version, definitionDigest: 'digest' },
    request: {
      kind: 'fresh',
      request: {
        agent: { id: definition.id, version: definition.version },
        output: { directory: '/output/session' },
        parameters: { model: 'fast' },
        permissions: { write: true },
        sessionId: 'session_01',
        workspace: { directory: '/workspace' },
      },
    },
    ...overrides,
  };
};

const setup = (
  options: {
    readonly create?: 'created' | 'conflict' | 'invalid_path' | 'uncertain' | 'throw';
    readonly definition?: ValidatedAgentDefinition;
    readonly inspect?: readonly (
      | 'directory'
      | 'missing'
      | 'not_directory'
      | 'uncertain'
      | 'throw'
    )[];
    readonly preflight?: Awaited<ReturnType<ExecutablePreflight['probe']>>;
  } = {},
) => {
  const inspections = [...(options.inspect ?? ['directory', 'directory'])];
  const outputClaimPlatform: OutputClaimPlatform = {
    createExclusiveDirectory: async () => {
      if (options.create === 'throw') throw new Error('filesystem unavailable');
      return options.create ?? 'created';
    },
    inspectDirectory: async () => {
      const result = inspections.shift() ?? 'directory';
      if (result === 'throw') throw new Error('inspection unavailable');
      return result;
    },
  };
  const executablePreflight: ExecutablePreflight = {
    probe: vi.fn(async () => {
      if (options.preflight !== undefined) return options.preflight;
      return {
        launch: { executable: '/usr/bin/node', reportedVersion: '1.0.0' },
        status: 'ready' as const,
      };
    }),
  };
  const target: SessionOutputPublicationTarget = {
    publish: async () => ({
      files: {
        directory: '/output/session',
        manifest: 'session.json',
        stderr: 'stderr.log',
        stdout: 'stdout.log',
      },
      state: 'published',
    }),
  };
  const outputTarget = vi.fn(() => target);
  const selected = options.definition ?? validated();
  const preparer = createSessionOpeningPreparer({
    definitions: {
      get: (ref) =>
        (ref as { id?: string; version?: string }).id === selected.definition.id &&
        (ref as { id?: string; version?: string }).version === selected.definition.version
          ? selected
          : undefined,
      list: () => [selected],
    },
    executablePreflight,
    outputClaimPlatform,
    outputTarget,
  });
  return { executablePreflight, outputTarget, preparer, target };
};

test('prepares a pinned literal launch with immutable effective inputs and optional environment', async () => {
  const story = setup();
  const request = opening({
    environment: { secrets: ['TOKEN'], values: { TOKEN: 'secret' } },
  });

  await expect(
    story.preparer.prepare(request, { signal: new AbortController().signal }),
  ).resolves.toEqual({
    status: 'prepared',
    value: {
      definition,
      inputs: { parameters: { model: 'fast' }, permissions: { write: true } },
      launch: {
        args: ['bridge.mjs'],
        command: '/usr/bin/node',
        cwd: '/workspace',
        environment: { TOKEN: 'secret' },
      },
      output: story.target,
    },
  });
  expect(story.outputTarget).toHaveBeenCalledOnce();

  const withoutEnvironment = setup();
  await expect(
    withoutEnvironment.preparer.prepare(opening(), { signal: new AbortController().signal }),
  ).resolves.toMatchObject({ status: 'prepared', value: { launch: { cwd: '/workspace' } } });
});

test('rejects a missing or stale definition pin', async () => {
  const story = setup();
  for (const pin of [
    { agentId: 'missing', agentVersion: definition.version, definitionDigest: 'digest' },
    { agentId: definition.id, agentVersion: definition.version, definitionDigest: 'stale' },
  ]) {
    // oxlint-disable-next-line no-await-in-loop -- the table shares one preflight story and verifies ordered rejection
    await expect(
      story.preparer.prepare(opening({ pin }), { signal: new AbortController().signal }),
    ).resolves.toMatchObject({
      fault: { code: 'revo.agent.continuation_pin_mismatch' },
      status: 'rejected',
    });
  }
});

test.each([
  ['parameters', { model: 1 }, { write: true }, 'revo.agent.parameters_invalid'],
  ['permissions', { model: 'fast' }, { write: 'yes' }, 'revo.agent.permissions_invalid'],
] as const)(
  'rejects invalid %s before preflight',
  async (_label, parameters, permissions, code) => {
    const story = setup();
    const value = opening();
    if (value.request.kind !== 'fresh') throw new Error('fixture must be fresh');
    await expect(
      story.preparer.prepare(
        {
          ...value,
          request: {
            kind: 'fresh',
            request: { ...value.request.request, parameters, permissions },
          },
        },
        { signal: new AbortController().signal },
      ),
    ).resolves.toMatchObject({ fault: { code }, status: 'rejected' });
    // oxlint-disable-next-line typescript/unbound-method -- Vitest inspects the spy without invoking it
    expect(story.executablePreflight.probe).not.toHaveBeenCalled();
  },
);

test('rejects a definition whose launch cannot be represented as literal process arguments', async () => {
  const unsupported = validated({
    ...definition,
    launch: { ...definition.launch, args: [{ kind: 'workspace' }] },
  });
  const story = setup({ definition: unsupported });
  await expect(
    story.preparer.prepare(opening(), { signal: new AbortController().signal }),
  ).resolves.toMatchObject({
    fault: { code: 'revo.agent.strategy_unsupported' },
    status: 'rejected',
  });
});

test.each([
  ['workspace invalid', ['missing'], undefined, 'revo.agent.workspace_invalid'],
  ['output parent invalid', ['directory', 'missing'], undefined, 'revo.agent.output_path_invalid'],
  [
    'output inspection uncertain',
    ['directory', 'uncertain'],
    undefined,
    'revo.agent.output_path_invalid',
  ],
  ['output inspection throws', ['throw'], undefined, 'revo.agent.output_path_invalid'],
  ['output conflict', undefined, 'conflict', 'revo.agent.output_conflict'],
  ['output invalid at claim', undefined, 'invalid_path', 'revo.agent.output_path_invalid'],
  ['output uncertain at claim', undefined, 'uncertain', 'revo.agent.output_path_invalid'],
  ['output claim throws', undefined, 'throw', 'revo.agent.output_path_invalid'],
] as const)('maps process admission rejection: %s', async (_label, inspect, create, code) => {
  const story = setup({
    ...(create === undefined ? {} : { create }),
    ...(inspect === undefined ? {} : { inspect }),
  });
  await expect(
    story.preparer.prepare(opening(), { signal: new AbortController().signal }),
  ).resolves.toMatchObject({ fault: { code }, status: 'rejected' });
});

test('maps cancellation and executable preflight rejection', async () => {
  const cancelled = setup({ preflight: { status: 'aborted' } });
  await expect(
    cancelled.preparer.prepare(opening(), { signal: new AbortController().signal }),
  ).resolves.toMatchObject({ fault: { code: 'revo.agent.cancelled' }, status: 'rejected' });

  const rejected = setup({
    preflight: { reason: 'probe_spawn_failed', status: 'rejected' },
  });
  await expect(
    rejected.preparer.prepare(opening(), { signal: new AbortController().signal }),
  ).resolves.toMatchObject({
    fault: { code: 'revo.agent.probe_spawn_failed' },
    status: 'rejected',
  });
});
