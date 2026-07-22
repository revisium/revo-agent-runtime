import { expect, test } from 'vitest';

import { validateManagerOptions } from '../../../../src/runtime/definition/index.js';
import { AgentManagerError } from '../../../../src/runtime/errors/index.js';
import {
  AGENT_FAULT_MESSAGES,
  AGENT_MANAGER_LIMITS,
} from '../../../../src/runtime/policy/index.js';
import type { AgentFault, AgentManagerOptions } from '../../../../src/runtime/spec/index.js';
import {
  buildAgentDefinition,
  buildAgentManagerOptions,
  p1ObjectSchema,
} from '../../../support/definition/build-agent-definition.js';

const definitionInvalidFault = (
  keyword: string,
  instancePath: string,
  message: string,
): AgentFault => ({
  code: 'revo.agent.definition_invalid',
  message: AGENT_FAULT_MESSAGES.definitionInvalid,
  phase: 'construction',
  retryable: false,
  details: {
    diagnostics: [
      {
        instancePath,
        instancePathTruncated: false,
        schemaPath: `/${keyword}`,
        schemaPathTruncated: false,
        keyword,
        message,
      },
    ],
    truncated: false,
  },
});

const faultFrom = (operation: () => unknown): AgentFault => {
  try {
    operation();
  } catch (error: unknown) {
    if (error instanceof AgentManagerError) return error.fault;
    throw error;
  }

  throw new Error('Expected an AgentManagerError.');
};

test('returns frozen package-owned snapshots and effective defaults', () => {
  const definitions = [buildAgentDefinition()];
  const secrets = ['secret'];
  const options: AgentManagerOptions = buildAgentManagerOptions({
    definitions,
    limits: { maxEventBytes: 1_024 },
    redaction: { secrets },
  });
  const construction = validateManagerOptions(options);

  expect(construction.definitions).toHaveLength(1);
  expect(construction.definitions[0]?.definition).toEqual(options.definitions[0]);
  expect(construction.definitions[0]?.definitionDigest).toMatch(/^[0-9a-f]{64}$/);
  expect(construction.limits).toEqual({
    wallClockTimeoutMs: AGENT_MANAGER_LIMITS.wallClockTimeoutMs.default,
    idleTimeoutMs: AGENT_MANAGER_LIMITS.idleTimeoutMs.default,
    maxEventBytes: 1_024,
    maxEventsFileBytes: AGENT_MANAGER_LIMITS.maxEventsFileBytes.default,
    maxStdoutBytes: AGENT_MANAGER_LIMITS.maxStdoutBytes.default,
    maxStderrBytes: AGENT_MANAGER_LIMITS.maxStderrBytes.default,
    maxRawResponseBytes: AGENT_MANAGER_LIMITS.maxRawResponseBytes.default,
    maxCompletedInvocations: AGENT_MANAGER_LIMITS.maxCompletedInvocations.default,
  });
  expect(Object.isFrozen(construction)).toBe(true);
  expect(Object.isFrozen(construction.definitions)).toBe(true);
  expect(Object.isFrozen(construction.definitions[0]?.definition)).toBe(true);
  expect(Object.isFrozen(construction.limits)).toBe(true);
  expect(Object.isFrozen(construction.redaction)).toBe(true);
  expect(Object.isFrozen(construction.redaction.secrets)).toBe(true);

  definitions.push(buildAgentDefinition({ id: 'later-agent' }));
  secrets[0] = 'changed';
  expect(construction.definitions).toHaveLength(1);
  expect(construction.redaction.secrets).toEqual(['secret']);
});

test.each([
  [
    'native definition without a result parser',
    buildAgentDefinition({
      protocol: { driver: 'native/stdio-v1', permissionStrategy: 'codex-cli/v1' },
    }),
    '/definitions/0/protocol/resultParser',
  ],
  [
    'ACP definition with stdout delivery',
    buildAgentDefinition({
      protocol: { driver: 'acp/v1', permissionStrategy: 'acp/v1' },
      delivery: { prompt: 'protocol', resultSchema: 'protocol', result: 'stdout' },
      launch: { command: '/fixture/bin/agent', args: [] },
    }),
    '/definitions/0/delivery/result',
  ],
  [
    'argument prompt with a prompt-file template',
    buildAgentDefinition({
      launch: {
        command: '/fixture/bin/agent',
        args: [{ kind: 'prompt-file' }, { kind: 'result-schema' }],
        versionProbe: { args: ['--version'], stream: 'stdout', timeoutMs: 1_000 },
      },
    }),
    '/definitions/0/launch/args',
  ],
] as const)('rejects incoherent known strategy fields: %s', (_name, definition, instancePath) => {
  expect(faultFrom(() => validateManagerOptions({ definitions: [definition] }))).toEqual(
    definitionInvalidFault(
      'definition_coherence',
      instancePath,
      'Agent definition fields are not coherent.',
    ),
  );
});

test('rejects canonical definitions above the configured byte bound', () => {
  const definition = buildAgentDefinition({
    launch: {
      command: '/fixture/bin/agent',
      args: [
        ...Array.from({ length: 5 }, () => ({
          kind: 'literal' as const,
          value: 'x'.repeat(262_144),
        })),
        { kind: 'prompt' },
        { kind: 'result-schema' },
      ],
      versionProbe: { args: ['--version'], stream: 'stdout', timeoutMs: 1_000 },
    },
  });

  expect(faultFrom(() => validateManagerOptions({ definitions: [definition] }))).toEqual(
    definitionInvalidFault(
      'definition_bytes',
      '/definitions/0',
      'Definition canonical UTF-8 representation exceeds 1 MiB.',
    ),
  );
});

test('rejects duplicate exact references and allows another version of the same agent', () => {
  const duplicate = buildAgentDefinition();
  expect(faultFrom(() => validateManagerOptions({ definitions: [duplicate, duplicate] }))).toEqual({
    code: 'revo.agent.definition_duplicate',
    message: AGENT_FAULT_MESSAGES.definitionDuplicate,
    phase: 'construction',
    retryable: false,
    details: { agent: { id: 'fixture-agent', version: '1.0.0' }, firstIndex: 0, duplicateIndex: 1 },
  });

  expect(
    validateManagerOptions({
      definitions: [duplicate, buildAgentDefinition({ version: '2.0.0' })],
    }).definitions,
  ).toHaveLength(2);
});

test('propagates consumer-schema profile failures before construction succeeds', () => {
  const definition = buildAgentDefinition({
    parameters: { schema: { ...p1ObjectSchema, patternProperties: {} }, defaults: {} },
  });
  const fault = faultFrom(() => validateManagerOptions({ definitions: [definition] }));

  expect(fault.code).toBe('revo.agent.definition_invalid');
  expect(fault.details).toMatchObject({
    diagnostics: [{ instancePath: '/definitions/0/parameters/schema/patternProperties' }],
  });
});

test('rejects incoherent effective limits and oversized redaction data', () => {
  const limitFault = faultFrom(() =>
    validateManagerOptions(
      buildAgentManagerOptions({ limits: { idleTimeoutMs: 2_000, wallClockTimeoutMs: 1_000 } }),
    ),
  );
  expect(limitFault).toEqual({
    code: 'revo.agent.limit_invalid',
    message: AGENT_FAULT_MESSAGES.limitInvalid,
    phase: 'construction',
    retryable: false,
    details: {
      diagnostics: [
        {
          instancePath: '/limits/idleTimeoutMs',
          instancePathTruncated: false,
          schemaPath: '/limit_relation',
          schemaPathTruncated: false,
          keyword: 'limit_relation',
          message: 'Agent manager limits are not coherent.',
        },
      ],
      truncated: false,
    },
  });
  expect(
    faultFrom(() =>
      validateManagerOptions(
        buildAgentManagerOptions({ redaction: { secrets: ['x'.repeat(65_537)] } }),
      ),
    ),
  ).toEqual(
    definitionInvalidFault(
      'redaction_bytes',
      '/redaction/secrets',
      'Redaction secrets exceed the configured bound.',
    ),
  );
});
