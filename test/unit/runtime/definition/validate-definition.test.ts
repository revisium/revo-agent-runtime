import { createHash } from 'node:crypto';

import { expect, test, vi } from 'vitest';

const compileConsumerSchemaSpy = vi.hoisted(() => vi.fn());

interface ConsumerSchemaValidatorModule {
  compileConsumerSchema(...arguments_: never[]): unknown;
}

vi.mock(
  '../../../../src/runtime/definition/consumer-schema-validator/index.js',
  async (importOriginal) => {
    const actual = await importOriginal<ConsumerSchemaValidatorModule>();

    return {
      ...actual,
      compileConsumerSchema: (...arguments_: never[]) => {
        compileConsumerSchemaSpy();
        return actual.compileConsumerSchema(...arguments_);
      },
    };
  },
);

import {
  canonicalizeJsonBytes,
  validateManagerOptions,
} from '../../../../src/runtime/definition/index.js';
import { AgentManagerError } from '../../../../src/runtime/errors/index.js';
import {
  AGENT_FAULT_MESSAGES,
  AGENT_MANAGER_LIMITS,
} from '../../../../src/runtime/policy/index.js';
import type {
  AgentFault,
  AgentManagerOptions,
  JsonObject,
  JsonValue,
} from '../../../../src/runtime/spec/index.js';
import {
  buildAgentDefinition,
  buildAgentManagerOptions,
  p1ObjectSchema,
} from '../../../support/definition/build-agent-definition.js';

const definitionInvalidFault = (
  keyword: string,
  instancePath: string,
  message: string,
  schemaPath = `/${keyword}`,
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
        schemaPath,
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

const coherenceFault = (instancePath: string): AgentFault =>
  definitionInvalidFault(
    'definition_coherence',
    instancePath,
    'Agent definition fields are not coherent.',
  );

const limitShapeFault = (instancePath: string): AgentFault => ({
  code: 'revo.agent.limit_invalid',
  message: AGENT_FAULT_MESSAGES.limitInvalid,
  phase: 'construction',
  retryable: false,
  details: {
    diagnostics: [
      {
        instancePath,
        instancePathTruncated: false,
        schemaPath: '/limit_shape',
        schemaPathTruncated: false,
        keyword: 'limit_shape',
        message: 'Value does not satisfy the agent manager limits.',
      },
    ],
    truncated: false,
  },
});

const limitRelationFault = (instancePath: string): AgentFault => ({
  code: 'revo.agent.limit_invalid',
  message: AGENT_FAULT_MESSAGES.limitInvalid,
  phase: 'construction',
  retryable: false,
  details: {
    diagnostics: [
      {
        instancePath,
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

const nativeDefinition = (overrides: Parameters<typeof buildAgentDefinition>[0] = {}) =>
  buildAgentDefinition(overrides);

const acpDefinition = (overrides: Parameters<typeof buildAgentDefinition>[0] = {}) => {
  const { constraints: _constraints, ...definition } = buildAgentDefinition({
    protocol: { driver: 'acp/v1', permissionStrategy: 'acp/v1' },
    delivery: { prompt: 'protocol', resultSchema: 'protocol', result: 'protocol' },
    launch: { command: '/fixture/bin/agent', args: [] },
  });

  return { ...definition, ...overrides };
};

const isJsonValue = (value: unknown): value is JsonValue => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value === 'object') return Object.values(value).every(isJsonValue);
  return false;
};

const isJsonObject = (value: unknown): value is JsonObject =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.values(value).every(isJsonValue);

const jsonObject = (value: unknown): JsonObject => {
  if (isJsonObject(value)) return value;
  throw new Error('Expected a JSON object.');
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

test('accepts one thousand unique definitions and rejects one thousand one', () => {
  const thousand = Array.from({ length: 1_000 }, (_, index) =>
    nativeDefinition({ id: `agent-${index}` }),
  );

  expect(validateManagerOptions({ definitions: thousand }).definitions).toHaveLength(1_000);
  expect(
    faultFrom(() =>
      validateManagerOptions({
        definitions: [...thousand, nativeDefinition({ id: 'agent-1000' })],
      }),
    ),
  ).toEqual(
    definitionInvalidFault(
      'manager_options_shape',
      '/definitions',
      'Value does not satisfy the agent manager options DTO.',
    ),
  );
}, 20_000);

test('accepts and bounds redaction value counts and total bytes', () => {
  expect(
    validateManagerOptions(
      buildAgentManagerOptions({ redaction: { secrets: Array.from({ length: 1_000 }, () => '') } }),
    ).redaction.secrets,
  ).toHaveLength(1_000);
  expect(
    faultFrom(() =>
      validateManagerOptions(
        buildAgentManagerOptions({
          redaction: { secrets: Array.from({ length: 1_001 }, () => '') },
        }),
      ),
    ),
  ).toEqual(
    definitionInvalidFault(
      'redaction_shape',
      '/redaction/secrets',
      'Value does not satisfy the redaction options.',
    ),
  );
  expect(
    validateManagerOptions(
      buildAgentManagerOptions({ redaction: { secrets: ['x'.repeat(65_536)] } }),
    ).redaction.secrets,
  ).toEqual(['x'.repeat(65_536)]);
});

test.each([
  ['wallClockTimeoutMs', 999, 1_000, 1_800_000, 1_800_001],
  ['idleTimeoutMs', 999, 1_000, 300_000, 300_001],
  ['maxEventBytes', 1_023, 1_024, 65_536, 65_537],
  ['maxStdoutBytes', 65_535, 65_536, 8_388_608, 8_388_609],
  ['maxStderrBytes', 65_535, 65_536, 8_388_608, 8_388_609],
  ['maxRawResponseBytes', 65_535, 65_536, 1_048_576, 1_048_577],
  ['maxCompletedInvocations', 0, 1, 1_000, 1_001],
] as const)(
  'enforces the minimum and maximum triplet for %s',
  (field, below, minimum, maximum, above) => {
    const coherentMinimum =
      field === 'wallClockTimeoutMs'
        ? { wallClockTimeoutMs: minimum, idleTimeoutMs: 1_000 }
        : { [field]: minimum };
    expect(
      validateManagerOptions(buildAgentManagerOptions({ limits: coherentMinimum })).limits,
    ).toMatchObject(coherentMinimum);
    expect(
      validateManagerOptions(buildAgentManagerOptions({ limits: { [field]: maximum } })).limits,
    ).toMatchObject({
      [field]: maximum,
    });
    for (const value of [below, above]) {
      expect(
        faultFrom(() =>
          validateManagerOptions(buildAgentManagerOptions({ limits: { [field]: value } })),
        ),
      ).toEqual(limitShapeFault(`/limits/${field}`));
    }
  },
);

test('enforces manager-limit integral values and cross-field reservations', () => {
  expect(
    faultFrom(() =>
      validateManagerOptions(buildAgentManagerOptions({ limits: { maxEventBytes: 1.5 } })),
    ),
  ).toEqual(limitShapeFault('/limits/maxEventBytes'));
  expect(
    faultFrom(() =>
      validateManagerOptions(
        buildAgentManagerOptions({ limits: { maxEventBytes: Number.POSITIVE_INFINITY } }),
      ),
    ),
  ).toEqual({
    code: 'revo.agent.limit_invalid',
    message: AGENT_FAULT_MESSAGES.limitInvalid,
    phase: 'construction',
    retryable: false,
    details: {
      diagnostics: [
        {
          instancePath: '/limits/maxEventBytes',
          instancePathTruncated: false,
          schemaPath: '/json_finite',
          schemaPathTruncated: false,
          keyword: 'json_finite',
          message: 'Number must be finite.',
        },
      ],
      truncated: false,
    },
  });

  const reservation = 2_097_152 + 65_536 + 2;
  expect(
    faultFrom(() =>
      validateManagerOptions(
        buildAgentManagerOptions({ limits: { maxEventsFileBytes: reservation - 1 } }),
      ),
    ),
  ).toEqual(limitRelationFault('/limits/maxEventsFileBytes'));
  expect(
    validateManagerOptions(
      buildAgentManagerOptions({ limits: { maxEventsFileBytes: reservation } }),
    ).limits.maxEventsFileBytes,
  ).toBe(reservation);
  expect(
    validateManagerOptions(buildAgentManagerOptions({ limits: { maxEventsFileBytes: 16_777_216 } }))
      .limits.maxEventsFileBytes,
  ).toBe(16_777_216);
  expect(
    faultFrom(() =>
      validateManagerOptions(
        buildAgentManagerOptions({
          limits: { maxEventBytes: 65_536, maxEventsFileBytes: reservation - 1 },
        }),
      ),
    ),
  ).toEqual(limitRelationFault('/limits/maxEventsFileBytes'));
  expect(
    faultFrom(() =>
      validateManagerOptions(
        buildAgentManagerOptions({ limits: { maxEventsFileBytes: 16_777_217 } }),
      ),
    ),
  ).toEqual(limitRelationFault('/limits/maxEventsFileBytes'));
});

test('accepts an exactly one MiB canonical definition', () => {
  const emptyDefinition = nativeDefinition({
    parameters: { schema: { ...p1ObjectSchema, type: 'string', enum: [''] } },
  });
  const overhead = new TextEncoder().encode(JSON.stringify(emptyDefinition)).byteLength;
  const definition = nativeDefinition({
    parameters: {
      schema: { ...p1ObjectSchema, type: 'string', enum: ['x'.repeat(1_048_576 - overhead)] },
    },
  });

  expect(new TextEncoder().encode(JSON.stringify(definition)).byteLength).toBe(1_048_576);
  expect(validateManagerOptions({ definitions: [definition] }).definitions).toHaveLength(1);
});

test('keeps snapshots, limits, and caller-owned nested objects isolated', () => {
  const launch = {
    command: '/fixture/bin/agent',
    args: [{ kind: 'prompt' as const }, { kind: 'result-schema' as const }],
    versionProbe: { args: ['--version'], stream: 'stdout' as const, timeoutMs: 1_000 },
  };
  const definition = nativeDefinition({ launch });
  const limits = { maxEventBytes: 1_024 };
  const construction = validateManagerOptions(
    buildAgentManagerOptions({ definitions: [definition], limits }),
  );

  launch.command = '/changed';
  launch.versionProbe.args[0] = '--changed';
  limits.maxEventBytes = 65_536;
  expect(construction.definitions[0]?.definition.launch.command).toBe('/fixture/bin/agent');
  expect(construction.definitions[0]?.definition.launch.versionProbe?.args).toEqual(['--version']);
  expect(construction.limits.maxEventBytes).toBe(1_024);
  expect(Object.isFrozen(construction.definitions[0]?.definition.launch)).toBe(true);
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
  expect(faultFrom(() => validateManagerOptions({ definitions: [definition] }))).toEqual(
    definitionInvalidFault(
      'keyword_allowlist',
      '/definitions/0/parameters/schema/patternProperties',
      'Keyword is not allowed by the consumer-schema profile.',
    ),
  );
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

test.each([
  [
    'plain-data accessors before DTO parsing',
    Object.defineProperty({}, 'definitions', { enumerable: true, get: () => [] }),
    definitionInvalidFault(
      'json_property_data',
      '/definitions',
      'Property must be an own enumerable data property.',
    ),
  ],
  [
    'an unknown top-level DTO key',
    { definitions: [nativeDefinition()], unexpected: true },
    definitionInvalidFault(
      'manager_options_shape',
      '/',
      'Value does not satisfy the agent manager options DTO.',
    ),
  ],
  [
    'an unknown nested limits key',
    { definitions: [nativeDefinition()], limits: { unexpected: true } },
    limitShapeFault('/limits'),
  ],
  [
    'an oversized definition list',
    {
      definitions: Array.from({ length: 1_001 }, (_, index) =>
        nativeDefinition({ id: `agent-${index}` }),
      ),
    },
    definitionInvalidFault(
      'manager_options_shape',
      '/definitions',
      'Value does not satisfy the agent manager options DTO.',
    ),
  ],
] as const)('sanitizes construction faults for %s', (_name, value, expectedFault) => {
  const fault = faultFrom(() => validateManagerOptions(value));

  expect(fault).toEqual(expectedFault);
});

test('classifies an unsupported strategy before coherence validation', () => {
  const fault = faultFrom(() =>
    validateManagerOptions({
      definitions: [
        nativeDefinition({
          protocol: { driver: 'future/v1', permissionStrategy: 'codex-cli/v1' },
          delivery: { prompt: 'protocol', resultSchema: 'protocol', result: 'protocol' },
        }),
      ],
    }),
  );

  expect(fault).toEqual({
    code: 'revo.agent.strategy_unsupported',
    message: AGENT_FAULT_MESSAGES.strategyUnsupported,
    phase: 'construction',
    retryable: false,
  });
});

test.each([
  [
    'argument prompt without exactly one prompt template',
    nativeDefinition({
      launch: { command: '/fixture/bin/agent', args: [{ kind: 'result-schema' }] },
    }),
  ],
  [
    'file prompt without exactly one prompt-file template',
    nativeDefinition({
      delivery: { prompt: 'file', resultSchema: 'argument', result: 'stdout' },
      launch: {
        command: '/fixture/bin/agent',
        args: [{ kind: 'prompt' }, { kind: 'result-schema' }],
      },
    }),
  ],
  [
    'stdin prompt with a prompt template',
    nativeDefinition({
      delivery: { prompt: 'stdin', resultSchema: 'argument', result: 'stdout' },
    }),
  ],
  [
    'argument result schema without exactly one result-schema template',
    nativeDefinition({
      launch: { command: '/fixture/bin/agent', args: [{ kind: 'prompt' }] },
    }),
  ],
  [
    'file result schema without exactly one result-schema-file template',
    nativeDefinition({
      delivery: { prompt: 'argument', resultSchema: 'file', result: 'stdout' },
      launch: {
        command: '/fixture/bin/agent',
        args: [{ kind: 'prompt' }, { kind: 'result-schema' }],
      },
    }),
  ],
  [
    'protocol result schema with a result-schema template',
    acpDefinition({ launch: { command: '/fixture/bin/agent', args: [{ kind: 'result-schema' }] } }),
  ],
] as const)('rejects each template-coherence rule: %s', (_name, definition) => {
  expect(faultFrom(() => validateManagerOptions({ definitions: [definition] }))).toEqual(
    coherenceFault('/definitions/0/launch/args'),
  );
});

test.each([
  [
    'native result parser is required',
    nativeDefinition({
      protocol: { driver: 'native/stdio-v1', permissionStrategy: 'codex-cli/v1' },
    }),
    '/definitions/0/protocol/resultParser',
  ],
  [
    'native prompt delivery cannot be protocol',
    nativeDefinition({
      delivery: { prompt: 'protocol', resultSchema: 'argument', result: 'stdout' },
    }),
    '/definitions/0/delivery/prompt',
  ],
  [
    'native result-schema delivery cannot be protocol',
    nativeDefinition({
      delivery: { prompt: 'argument', resultSchema: 'protocol', result: 'stdout' },
    }),
    '/definitions/0/delivery/resultSchema',
  ],
  [
    'native result delivery must be stdout',
    nativeDefinition({
      delivery: { prompt: 'argument', resultSchema: 'argument', result: 'protocol' },
    }),
    '/definitions/0/delivery/result',
  ],
  [
    'native permission family must match its parser',
    nativeDefinition({
      protocol: {
        driver: 'native/stdio-v1',
        resultParser: 'codex-jsonl/v1',
        permissionStrategy: 'claude-cli/v1',
      },
    }),
    '/definitions/0/protocol/permissionStrategy',
  ],
  [
    'ACP must not supply a result parser',
    acpDefinition({
      protocol: { driver: 'acp/v1', resultParser: 'codex-jsonl/v1', permissionStrategy: 'acp/v1' },
    }),
    '/definitions/0/protocol/resultParser',
  ],
  [
    'ACP prompt delivery must be protocol',
    acpDefinition({
      delivery: { prompt: 'argument', resultSchema: 'protocol', result: 'protocol' },
    }),
    '/definitions/0/delivery/prompt',
  ],
  [
    'ACP result-schema delivery must be protocol',
    acpDefinition({
      delivery: { prompt: 'protocol', resultSchema: 'argument', result: 'protocol' },
    }),
    '/definitions/0/delivery/resultSchema',
  ],
  [
    'ACP result delivery must be protocol',
    acpDefinition({ delivery: { prompt: 'protocol', resultSchema: 'protocol', result: 'stdout' } }),
    '/definitions/0/delivery/result',
  ],
  [
    'ACP permission family must be ACP',
    acpDefinition({ protocol: { driver: 'acp/v1', permissionStrategy: 'codex-cli/v1' } }),
    '/definitions/0/protocol/permissionStrategy',
  ],
] as const)(
  'rejects each native or ACP coherence violation: %s',
  (_name, definition, instancePath) => {
    expect(faultFrom(() => validateManagerOptions({ definitions: [definition] }))).toEqual(
      coherenceFault(instancePath),
    );
  },
);

test.each([
  nativeDefinition(),
  nativeDefinition({
    protocol: {
      driver: 'native/stdio-v1',
      resultParser: 'claude-stream-json/v1',
      permissionStrategy: 'claude-cli/v1',
    },
  }),
  acpDefinition(),
])('accepts each coherent protocol/parser/permission family', (definition) => {
  expect(validateManagerOptions({ definitions: [definition] }).definitions).toHaveLength(1);
});

test.each([
  nativeDefinition({
    delivery: { prompt: 'file', resultSchema: 'argument', result: 'stdout' },
    launch: {
      command: '/fixture/bin/agent',
      args: [{ kind: 'prompt-file' }, { kind: 'result-schema' }],
      versionProbe: { args: ['--version'], stream: 'stdout', timeoutMs: 1_000 },
    },
  }),
  nativeDefinition({
    delivery: { prompt: 'stdin', resultSchema: 'argument', result: 'stdout' },
    launch: {
      command: '/fixture/bin/agent',
      args: [{ kind: 'result-schema' }],
      versionProbe: { args: ['--version'], stream: 'stdout', timeoutMs: 1_000 },
    },
  }),
  nativeDefinition({
    delivery: { prompt: 'argument', resultSchema: 'file', result: 'stdout' },
    launch: {
      command: '/fixture/bin/agent',
      args: [{ kind: 'prompt' }, { kind: 'result-schema-file' }],
      versionProbe: { args: ['--version'], stream: 'stdout', timeoutMs: 1_000 },
    },
  }),
])('accepts coherent native delivery and template variants', (definition) => {
  expect(validateManagerOptions({ definitions: [definition] }).definitions).toHaveLength(1);
});

test('propagates compiled consumer-schema defaults mismatches', () => {
  const schema = { ...p1ObjectSchema, properties: { name: { type: 'string' } } };
  for (const [domain, definition, instancePath] of [
    [
      'parameters',
      nativeDefinition({ parameters: { schema, defaults: { name: 1 } } }),
      '/definitions/0/parameters/defaults/name',
    ],
    [
      'permissions',
      nativeDefinition({ permissions: { schema, defaults: { name: 1 } } }),
      '/definitions/0/permissions/defaults/name',
    ],
  ] as const) {
    const fault = faultFrom(() => validateManagerOptions({ definitions: [definition] }));
    expect(fault).toEqual(
      definitionInvalidFault(
        'type',
        instancePath,
        'Value does not match the schema type.',
        '/properties/name/type',
      ),
    );
    expect(domain).toBeDefined();
  }
});

test('returns the snapshot parsed from canonical bytes with its independent digest', () => {
  const definition = nativeDefinition({
    id: 'canonical-agent',
    launch: {
      command: '/fixture/bin/agent',
      args: [{ kind: 'result-schema' }, { kind: 'prompt' }],
      versionProbe: { args: ['--version'], stream: 'stdout', timeoutMs: 1_000 },
    },
  });
  const canonicalBytes = canonicalizeJsonBytes(jsonObject(definition));
  const parsed: unknown = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(canonicalBytes),
  );
  const expectedSnapshot = jsonObject(parsed);
  const expectedDigest = createHash('sha256').update(canonicalBytes).digest('hex');
  const validated = validateManagerOptions({ definitions: [definition] }).definitions[0]!;

  expect(validated.definition).toEqual(expectedSnapshot);
  expect(validated.definitionDigest).toBe(expectedDigest);
  expect(validated.definition).not.toBe(definition);
});

test('reuses successful compiled schemas by admitted content within one construction', () => {
  const schema = () => ({ ...p1ObjectSchema });
  const definitions = [
    nativeDefinition({
      id: 'cache-agent-one',
      parameters: { schema: schema(), defaults: {} },
      permissions: { schema: schema(), defaults: {} },
    }),
    nativeDefinition({
      id: 'cache-agent-two',
      parameters: { schema: schema(), defaults: {} },
      permissions: { schema: schema(), defaults: {} },
    }),
  ];

  compileConsumerSchemaSpy.mockClear();
  expect(validateManagerOptions({ definitions }).definitions).toHaveLength(2);
  expect(compileConsumerSchemaSpy).toHaveBeenCalledTimes(1);
});

test('compiles distinct admitted schema contents separately and resets the cache per construction', () => {
  const objectSchema = () => ({ ...p1ObjectSchema });
  const namedSchema = () => ({ ...p1ObjectSchema, properties: { name: { type: 'string' } } });
  const definition = (id: string) =>
    nativeDefinition({
      id,
      parameters: { schema: objectSchema(), defaults: {} },
      permissions: { schema: namedSchema(), defaults: {} },
    });

  compileConsumerSchemaSpy.mockClear();
  expect(
    validateManagerOptions({ definitions: [definition('cache-agent-one')] }).definitions,
  ).toHaveLength(1);
  expect(compileConsumerSchemaSpy).toHaveBeenCalledTimes(2);
  expect(
    validateManagerOptions({ definitions: [definition('cache-agent-two')] }).definitions,
  ).toHaveLength(1);
  expect(compileConsumerSchemaSpy).toHaveBeenCalledTimes(4);
});

test('retains occurrence-specific defaults diagnostics when reusing a compiled schema', () => {
  const schema = { ...p1ObjectSchema, properties: { name: { type: 'string' } } };
  const definition = nativeDefinition({
    parameters: { schema, defaults: { name: 'valid' } },
    permissions: { schema: { ...schema }, defaults: { name: 1 } },
  });

  compileConsumerSchemaSpy.mockClear();
  expect(faultFrom(() => validateManagerOptions({ definitions: [definition] }))).toEqual(
    definitionInvalidFault(
      'type',
      '/definitions/0/permissions/defaults/name',
      'Value does not match the schema type.',
      '/properties/name/type',
    ),
  );
  expect(compileConsumerSchemaSpy).toHaveBeenCalledTimes(1);
});

test.each([
  [
    'version-probe argv larger than one MiB',
    nativeDefinition({
      launch: {
        command: 'x'.repeat(262_144),
        args: [{ kind: 'prompt' }, { kind: 'result-schema' }],
        versionProbe: {
          args: Array.from({ length: 4 }, () => 'x'.repeat(262_144)),
          stream: 'stdout',
          timeoutMs: 1_000,
        },
      },
    }),
    'definition_bytes',
    '/definitions/0',
  ],
  [
    'an executable constraint without a probe',
    nativeDefinition({
      launch: {
        command: '/fixture/bin/agent',
        args: [{ kind: 'prompt' }, { kind: 'result-schema' }],
      },
    }),
    'executable_version_constraint',
    '/definitions/0/constraints/executableVersion',
  ],
  [
    'a malformed executable constraint',
    nativeDefinition({ constraints: { executableVersion: 'not a constraint' } }),
    'executable_version_constraint',
    '/definitions/0/constraints/executableVersion',
  ],
] as const)(
  'rejects probe and constraint contracts: %s',
  (_name, definition, keyword, instancePath) => {
    const fault = faultFrom(() => validateManagerOptions({ definitions: [definition] }));
    expect(fault).toEqual(
      definitionInvalidFault(
        keyword,
        instancePath,
        keyword === 'definition_bytes'
          ? 'Definition canonical UTF-8 representation exceeds 1 MiB.'
          : 'Executable-version constraint is invalid.',
      ),
    );
  },
);
