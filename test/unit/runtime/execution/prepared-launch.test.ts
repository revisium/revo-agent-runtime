import { expect, test } from 'vitest';

import { ExecutionBindingToken, PreparedLaunch } from '../../../../src/runtime/execution/index.js';

const bindingToken = (
  overrides: Partial<Parameters<typeof ExecutionBindingToken.create>[0]> = {},
) =>
  ExecutionBindingToken.create({
    agentId: 'codex',
    agentVersion: '1.0.0',
    definitionDigest: 'definition-digest',
    protocolDriverId: 'native/stdio-v1',
    resultParserId: 'codex-jsonl/v1',
    permissionStrategyId: 'codex-cli/v1',
    delivery: { prompt: 'argument', resultSchema: 'argument', result: 'stdout' },
    ...overrides,
  });

const effectiveLimits = Object.freeze({
  wallClockTimeoutMs: 1_000,
  idleTimeoutMs: 1_000,
  maxEventBytes: 65_536,
  maxEventsFileBytes: 16_777_216,
  maxStdoutBytes: 8_388_608,
  maxStderrBytes: 8_388_608,
  maxRawResponseBytes: 1_048_576,
});
const effectiveParameters = Object.freeze({ model: 'gpt-5' });
const effectivePermissions = Object.freeze({ mode: 'workspace-write' });
const childEnvironment = Object.freeze({ REVO_ENV: 'value' });
const childEnvironmentSecretValues = Object.freeze(['secret-value']);
const secretValues = Object.freeze(['configured-secret', 'secret-value']);
const resultSchemaValidator = Object.freeze({ validate: () => undefined });

test('rejects prepared launch evidence without a reported version', () => {
  expect(
    PreparedLaunch.create({
      pin: {
        agentId: 'codex',
        agentVersion: '1.0.0',
        definitionDigest: 'definition-digest',
      },
      executable: '/usr/bin/codex',
    }),
  ).toBeUndefined();
});

test('creates prepared launch evidence with the exact execution-owned shape', () => {
  const prepared = PreparedLaunch.create({
    pin: {
      agentId: 'codex',
      agentVersion: '1.0.0',
      definitionDigest: 'definition-digest',
    },
    executable: '/usr/bin/codex',
    reportedVersion: '1.2.3',
    limits: effectiveLimits,
    effectiveParameters,
    effectivePermissions,
    childEnvironment,
    childEnvironmentSecretValues,
    secretValues,
    resultSchemaValidator,
    outputResourcePlan: {
      invocationId: 'test-invocation',
      outputDirectory: '/outputs/invocation',
      needsPromptFile: false,
      needsResultSchemaFile: false,
    },
    interpretedArgumentTemplate: [{ kind: 'arguments', arguments: ['exec'] }],
    preparedPayloads: { arguments: ['exec'], files: [] },
    binding: {
      protocolDriverId: 'native/stdio-v1',
      resultParserId: 'codex-jsonl/v1',
      permissionStrategyId: 'codex-cli/v1',
      delivery: { prompt: 'argument', resultSchema: 'argument', result: 'stdout' },
    },
    bindingToken: bindingToken(),
  });

  expect(prepared).toEqual({
    pin: {
      agentId: 'codex',
      agentVersion: '1.0.0',
      definitionDigest: 'definition-digest',
    },
    executable: '/usr/bin/codex',
    reportedVersion: '1.2.3',
    limits: effectiveLimits,
    effectiveParameters,
    effectivePermissions,
    binding: {
      protocolDriverId: 'native/stdio-v1',
      resultParserId: 'codex-jsonl/v1',
      permissionStrategyId: 'codex-cli/v1',
      delivery: { prompt: 'argument', resultSchema: 'argument', result: 'stdout' },
    },
  });
  expect(prepared?.binding).toEqual({
    protocolDriverId: 'native/stdio-v1',
    resultParserId: 'codex-jsonl/v1',
    permissionStrategyId: 'codex-cli/v1',
    delivery: { prompt: 'argument', resultSchema: 'argument', result: 'stdout' },
  });
  expect(prepared?.childEnvironment).toEqual({ REVO_ENV: 'value' });
  expect(prepared?.secretValues).toEqual(['configured-secret', 'secret-value']);
  expect(prepared?.resultSchemaValidator.validate({})).toBeUndefined();
  expect(prepared?.interpretedArgumentTemplate).toEqual([
    { kind: 'arguments', arguments: ['exec'] },
  ]);
});

test('accepts null-prototype record containers', () => {
  const pin = {
    agentId: 'codex',
    agentVersion: '1.0.0',
    definitionDigest: 'definition-digest',
  };
  const candidate = {
    pin,
    executable: '/usr/bin/codex',
    reportedVersion: '1.2.3',
    limits: effectiveLimits,
    effectiveParameters,
    effectivePermissions,
    childEnvironment,
    childEnvironmentSecretValues,
    secretValues,
    resultSchemaValidator,
    outputResourcePlan: {
      invocationId: 'test-invocation',
      outputDirectory: '/outputs/invocation',
      needsPromptFile: false,
      needsResultSchemaFile: false,
    },
    interpretedArgumentTemplate: [{ kind: 'arguments', arguments: ['exec'] }],
    preparedPayloads: { arguments: ['exec'], files: [] },
    binding: {
      protocolDriverId: 'native/stdio-v1',
      resultParserId: 'codex-jsonl/v1',
      permissionStrategyId: 'codex-cli/v1',
      delivery: { prompt: 'argument', resultSchema: 'argument', result: 'stdout' },
    },
    bindingToken: bindingToken(),
  };
  Object.setPrototypeOf(pin, null);
  Object.setPrototypeOf(candidate, null);

  expect(PreparedLaunch.create(candidate)).toEqual({
    pin: {
      agentId: 'codex',
      agentVersion: '1.0.0',
      definitionDigest: 'definition-digest',
    },
    executable: '/usr/bin/codex',
    reportedVersion: '1.2.3',
    limits: effectiveLimits,
    effectiveParameters,
    effectivePermissions,
    binding: {
      protocolDriverId: 'native/stdio-v1',
      resultParserId: 'codex-jsonl/v1',
      permissionStrategyId: 'codex-cli/v1',
      delivery: { prompt: 'argument', resultSchema: 'argument', result: 'stdout' },
    },
  });
});

test('rejects non-object outer and pin containers', () => {
  for (const candidate of [undefined, null, false, 'launch', [], () => undefined]) {
    expect(PreparedLaunch.create(candidate)).toBeUndefined();
  }

  for (const pin of [undefined, null, false, 'pin', []]) {
    expect(
      PreparedLaunch.create({
        pin,
        executable: '/usr/bin/codex',
        reportedVersion: '1.2.3',
      }),
    ).toBeUndefined();
  }
});

test('rejects Date and class-instance outer and pin containers', () => {
  class LaunchContainer {
    readonly pin = {
      agentId: 'codex',
      agentVersion: '1.0.0',
      definitionDigest: 'definition-digest',
    };
    readonly executable = '/usr/bin/codex';
    readonly reportedVersion = '1.2.3';
  }

  class PinContainer {
    readonly agentId = 'codex';
    readonly agentVersion = '1.0.0';
    readonly definitionDigest = 'definition-digest';
  }

  const pin = {
    agentId: 'codex',
    agentVersion: '1.0.0',
    definitionDigest: 'definition-digest',
  };
  const dateLaunch = Object.assign(new Date(0), {
    pin,
    executable: '/usr/bin/codex',
    reportedVersion: '1.2.3',
  });
  const datePin = Object.assign(new Date(0), pin);

  expect(PreparedLaunch.create(dateLaunch)).toBeUndefined();
  expect(PreparedLaunch.create(new LaunchContainer())).toBeUndefined();
  expect(
    PreparedLaunch.create({
      pin: datePin,
      executable: '/usr/bin/codex',
      reportedVersion: '1.2.3',
    }),
  ).toBeUndefined();
  expect(
    PreparedLaunch.create({
      pin: new PinContainer(),
      executable: '/usr/bin/codex',
      reportedVersion: '1.2.3',
    }),
  ).toBeUndefined();
});

test('rejects non-exact own data-property shapes', () => {
  const outerExtra = {
    pin: {
      agentId: 'codex',
      agentVersion: '1.0.0',
      definitionDigest: 'definition-digest',
    },
    executable: '/usr/bin/codex',
    reportedVersion: '1.2.3',
    extra: true,
  };
  const pinExtra = {
    pin: {
      agentId: 'codex',
      agentVersion: '1.0.0',
      definitionDigest: 'definition-digest',
      extra: true,
    },
    executable: '/usr/bin/codex',
    reportedVersion: '1.2.3',
  };
  const outerSymbol = {
    pin: {
      agentId: 'codex',
      agentVersion: '1.0.0',
      definitionDigest: 'definition-digest',
    },
    executable: '/usr/bin/codex',
    reportedVersion: '1.2.3',
    [Symbol('extra')]: true,
  };
  const pinSymbol = {
    pin: {
      agentId: 'codex',
      agentVersion: '1.0.0',
      definitionDigest: 'definition-digest',
      [Symbol('extra')]: true,
    },
    executable: '/usr/bin/codex',
    reportedVersion: '1.2.3',
  };
  const outerAccessor = {
    pin: {
      agentId: 'codex',
      agentVersion: '1.0.0',
      definitionDigest: 'definition-digest',
    },
    get executable() {
      return '/usr/bin/codex';
    },
    reportedVersion: '1.2.3',
  };
  const pinPropertyAccessor = {
    get pin() {
      return {
        agentId: 'codex',
        agentVersion: '1.0.0',
        definitionDigest: 'definition-digest',
      };
    },
    executable: '/usr/bin/codex',
    reportedVersion: '1.2.3',
  };
  const pinAccessor = {
    pin: {
      get agentId() {
        return 'codex';
      },
      agentVersion: '1.0.0',
      definitionDigest: 'definition-digest',
    },
    executable: '/usr/bin/codex',
    reportedVersion: '1.2.3',
  };
  const replacedOuterKey = {
    pin: {
      agentId: 'codex',
      agentVersion: '1.0.0',
      definitionDigest: 'definition-digest',
    },
    executable: '/usr/bin/codex',
    version: '1.2.3',
  };
  const replacedPinKey = {
    pin: {
      agentId: 'codex',
      agentVersion: '1.0.0',
      digest: 'definition-digest',
    },
    executable: '/usr/bin/codex',
    reportedVersion: '1.2.3',
  };

  for (const candidate of [
    outerExtra,
    pinExtra,
    outerSymbol,
    pinSymbol,
    outerAccessor,
    pinPropertyAccessor,
    pinAccessor,
    replacedOuterKey,
    replacedPinKey,
  ]) {
    expect(PreparedLaunch.create(candidate)).toBeUndefined();
  }
});

test('rejects missing, empty, and wrong-type semantic values', () => {
  const exact = {
    pin: {
      agentId: 'codex',
      agentVersion: '1.0.0',
      definitionDigest: 'definition-digest',
    },
    executable: '/usr/bin/codex',
    reportedVersion: '1.2.3',
    limits: effectiveLimits,
    effectiveParameters,
    effectivePermissions,
    childEnvironment,
    childEnvironmentSecretValues,
    secretValues,
    resultSchemaValidator,
    outputResourcePlan: {
      invocationId: 'test-invocation',
      outputDirectory: '/outputs/invocation',
      needsPromptFile: false,
      needsResultSchemaFile: false,
    },
    interpretedArgumentTemplate: [{ kind: 'arguments', arguments: ['exec'] }],
    preparedPayloads: { arguments: ['exec'], files: [] },
    binding: {
      protocolDriverId: 'native/stdio-v1',
      resultParserId: 'codex-jsonl/v1',
      permissionStrategyId: 'codex-cli/v1',
      delivery: { prompt: 'argument', resultSchema: 'argument', result: 'stdout' },
    },
    bindingToken: bindingToken(),
  };

  expect(PreparedLaunch.create({ ...exact, executable: '' })).toBeUndefined();
  expect(PreparedLaunch.create({ ...exact, reportedVersion: 123 })).toBeUndefined();
  expect(
    PreparedLaunch.create({ ...exact, pin: { ...exact.pin, definitionDigest: '' } }),
  ).toBeUndefined();
  expect(
    PreparedLaunch.create({ ...exact, pin: { ...exact.pin, agentVersion: false } }),
  ).toBeUndefined();
  expect(
    PreparedLaunch.create({ ...exact, pin: { ...exact.pin, agentId: undefined } }),
  ).toBeUndefined();
});

test('authenticates the exact full binding tuple in finalization material', () => {
  const exact = {
    pin: {
      agentId: 'codex',
      agentVersion: '1.0.0',
      definitionDigest: 'definition-digest',
    },
    executable: '/usr/bin/codex',
    reportedVersion: '1.2.3',
    limits: effectiveLimits,
    effectiveParameters,
    effectivePermissions,
    childEnvironment,
    childEnvironmentSecretValues,
    secretValues,
    resultSchemaValidator,
    outputResourcePlan: {
      invocationId: 'test-invocation',
      outputDirectory: '/outputs/invocation',
      needsPromptFile: false,
      needsResultSchemaFile: false,
    },
    interpretedArgumentTemplate: [{ kind: 'arguments', arguments: ['exec'] }],
    preparedPayloads: { arguments: ['exec'], files: [] },
    binding: {
      protocolDriverId: 'native/stdio-v1' as const,
      resultParserId: 'codex-jsonl/v1' as const,
      permissionStrategyId: 'codex-cli/v1' as const,
      delivery: {
        prompt: 'argument' as const,
        resultSchema: 'argument' as const,
        result: 'stdout' as const,
      },
    },
  };

  expect(PreparedLaunch.create({ ...exact, bindingToken: bindingToken() })).toBeDefined();
  expect(
    PreparedLaunch.create({
      ...exact,
      bindingToken: bindingToken({ permissionStrategyId: 'claude-cli/v1' }),
    }),
  ).toBeUndefined();
});

test('requires an authentic binding token matched to the launch pin', () => {
  const exact = {
    pin: {
      agentId: 'codex',
      agentVersion: '1.0.0',
      definitionDigest: 'definition-digest',
    },
    executable: '/usr/bin/codex',
    reportedVersion: '1.2.3',
    limits: effectiveLimits,
    effectiveParameters,
    effectivePermissions,
    childEnvironment,
    childEnvironmentSecretValues,
    secretValues,
    resultSchemaValidator,
    outputResourcePlan: {
      invocationId: 'test-invocation',
      outputDirectory: '/outputs/invocation',
      needsPromptFile: false,
      needsResultSchemaFile: false,
    },
    interpretedArgumentTemplate: [{ kind: 'arguments', arguments: ['exec'] }],
    preparedPayloads: { arguments: ['exec'], files: [] },
    binding: {
      protocolDriverId: 'native/stdio-v1' as const,
      resultParserId: 'codex-jsonl/v1' as const,
      permissionStrategyId: 'codex-cli/v1' as const,
      delivery: {
        prompt: 'argument' as const,
        resultSchema: 'argument' as const,
        result: 'stdout' as const,
      },
    },
  };

  expect(PreparedLaunch.create({ ...exact })).toBeUndefined();
  expect(
    PreparedLaunch.create({
      ...exact,
      bindingToken: {
        agentId: 'codex',
        agentVersion: '1.0.0',
        definitionDigest: 'definition-digest',
      },
    }),
  ).toBeUndefined();
  expect(
    PreparedLaunch.create({
      ...exact,
      bindingToken: bindingToken({ definitionDigest: 'other-definition-digest' }),
    }),
  ).toBeUndefined();
  expect(PreparedLaunch.create({ ...exact, bindingToken: bindingToken() })).toBeDefined();
});

test('copies caller containers and deeply freezes prepared launch evidence', () => {
  const candidate = {
    pin: {
      agentId: 'codex',
      agentVersion: '1.0.0',
      definitionDigest: 'definition-digest',
    },
    executable: '/usr/bin/codex',
    reportedVersion: '1.2.3',
    limits: { ...effectiveLimits },
    effectiveParameters: { nested: { value: 'parameter' } },
    effectivePermissions: { nested: { value: 'permission' } },
    childEnvironment: { nested: 'environment' },
    childEnvironmentSecretValues: ['secret'],
    secretValues: ['configured-secret', 'secret'],
    resultSchemaValidator,
    outputResourcePlan: {
      invocationId: 'test-invocation',
      outputDirectory: '/outputs/invocation',
      needsPromptFile: false,
      needsResultSchemaFile: false,
    },
    interpretedArgumentTemplate: [{ kind: 'arguments', arguments: ['exec'] }],
    preparedPayloads: { arguments: ['exec'], files: [] },
    binding: {
      protocolDriverId: 'native/stdio-v1',
      resultParserId: 'codex-jsonl/v1',
      permissionStrategyId: 'codex-cli/v1',
      delivery: { prompt: 'argument', resultSchema: 'argument', result: 'stdout' },
    },
    bindingToken: bindingToken(),
  };

  const prepared = PreparedLaunch.create(candidate);
  if (prepared === undefined) throw new Error('Expected valid prepared launch evidence');

  expect(prepared).not.toBe(candidate);
  expect(prepared.pin).not.toBe(candidate.pin);
  expect(Object.isFrozen(prepared)).toBe(true);
  expect(Object.isFrozen(prepared.pin)).toBe(true);
  expect(Object.isFrozen(prepared.limits)).toBe(true);
  expect(Object.isFrozen(prepared.effectiveParameters)).toBe(true);
  expect(Object.isFrozen(prepared.effectiveParameters.nested)).toBe(true);
  expect(Object.isFrozen(prepared.effectivePermissions)).toBe(true);
  expect(Object.isFrozen(prepared.effectivePermissions.nested)).toBe(true);
  expect(prepared.childEnvironment).toEqual({ nested: 'environment' });
  expect(prepared.secretValues).toEqual(['configured-secret', 'secret']);

  candidate.pin.agentId = 'mutated';
  candidate.executable = '/tmp/mutated';
  candidate.effectiveParameters.nested.value = 'mutated';
  candidate.effectivePermissions.nested.value = 'mutated';
  candidate.secretValues[0] = 'mutated';
  expect(prepared).toEqual({
    pin: {
      agentId: 'codex',
      agentVersion: '1.0.0',
      definitionDigest: 'definition-digest',
    },
    executable: '/usr/bin/codex',
    reportedVersion: '1.2.3',
    limits: effectiveLimits,
    effectiveParameters: { nested: { value: 'parameter' } },
    effectivePermissions: { nested: { value: 'permission' } },
    binding: {
      protocolDriverId: 'native/stdio-v1',
      resultParserId: 'codex-jsonl/v1',
      permissionStrategyId: 'codex-cli/v1',
      delivery: { prompt: 'argument', resultSchema: 'argument', result: 'stdout' },
    },
  });
});

test('requires copied effective limits in finalization material', () => {
  const limits = {
    wallClockTimeoutMs: 1_000,
    idleTimeoutMs: 1_000,
    maxEventBytes: 65_536,
    maxEventsFileBytes: 16_777_216,
    maxStdoutBytes: 8_388_608,
    maxStderrBytes: 8_388_608,
    maxRawResponseBytes: 1_048_576,
  };

  expect(
    PreparedLaunch.create({
      pin: {
        agentId: 'codex',
        agentVersion: '1.0.0',
        definitionDigest: 'definition-digest',
      },
      executable: '/usr/bin/codex',
      reportedVersion: '1.2.3',
    }),
  ).toBeUndefined();

  const prepared = PreparedLaunch.create({
    pin: {
      agentId: 'codex',
      agentVersion: '1.0.0',
      definitionDigest: 'definition-digest',
    },
    executable: '/usr/bin/codex',
    reportedVersion: '1.2.3',
    limits,
    effectiveParameters,
    effectivePermissions,
    childEnvironment,
    childEnvironmentSecretValues,
    secretValues,
    resultSchemaValidator,
    outputResourcePlan: {
      invocationId: 'test-invocation',
      outputDirectory: '/outputs/invocation',
      needsPromptFile: false,
      needsResultSchemaFile: false,
    },
    interpretedArgumentTemplate: [{ kind: 'arguments', arguments: ['exec'] }],
    preparedPayloads: { arguments: ['exec'], files: [] },
    binding: {
      protocolDriverId: 'native/stdio-v1',
      resultParserId: 'codex-jsonl/v1',
      permissionStrategyId: 'codex-cli/v1',
      delivery: { prompt: 'argument', resultSchema: 'argument', result: 'stdout' },
    },
    bindingToken: bindingToken(),
  });

  expect(prepared).toMatchObject({ limits });
  limits.wallClockTimeoutMs = 2_000;
  expect(prepared).toMatchObject({ limits: { wallClockTimeoutMs: 1_000 } });
  expect(Object.isFrozen(prepared?.limits)).toBe(true);
});

test('keeps registered secret values out of enumerable launch views', () => {
  const prepared = PreparedLaunch.create({
    pin: {
      agentId: 'codex',
      agentVersion: '1.0.0',
      definitionDigest: 'definition-digest',
    },
    executable: '/usr/bin/codex',
    reportedVersion: '1.2.3',
    limits: effectiveLimits,
    effectiveParameters,
    effectivePermissions,
    childEnvironment,
    childEnvironmentSecretValues,
    secretValues,
    resultSchemaValidator,
    outputResourcePlan: {
      invocationId: 'test-invocation',
      outputDirectory: '/outputs/invocation',
      needsPromptFile: false,
      needsResultSchemaFile: false,
    },
    interpretedArgumentTemplate: [{ kind: 'arguments', arguments: ['exec'] }],
    preparedPayloads: { arguments: ['exec'], files: [] },
    binding: {
      protocolDriverId: 'native/stdio-v1',
      resultParserId: 'codex-jsonl/v1',
      permissionStrategyId: 'codex-cli/v1',
      delivery: { prompt: 'argument', resultSchema: 'argument', result: 'stdout' },
    },
    bindingToken: bindingToken(),
  });
  if (prepared === undefined) throw new Error('Expected valid prepared launch evidence');

  expect(Object.getOwnPropertyDescriptor(prepared, 'secretValues')).toMatchObject({
    enumerable: false,
    writable: false,
    configurable: false,
  });
  expect(prepared.secretValues).toEqual(['configured-secret', 'secret-value']);
  expect(Object.isFrozen(prepared.secretValues)).toBe(true);
  expect(Object.keys(prepared)).not.toContain('secretValues');
  expect(JSON.stringify(prepared)).not.toContain('secret-value');
});

const preparedLaunchCandidate = (overrides: Record<string, unknown> = {}) => ({
  pin: {
    agentId: 'codex',
    agentVersion: '1.0.0',
    definitionDigest: 'definition-digest',
  },
  executable: '/usr/bin/codex',
  reportedVersion: '1.2.3',
  limits: effectiveLimits,
  effectiveParameters,
  effectivePermissions,
  childEnvironment,
  childEnvironmentSecretValues,
  secretValues,
  resultSchemaValidator,
  outputResourcePlan: {
    invocationId: 'test-invocation',
    outputDirectory: '/outputs/invocation',
    needsPromptFile: true,
    needsResultSchemaFile: true,
  },
  interpretedArgumentTemplate: [{ kind: 'arguments', arguments: ['exec'] }],
  preparedPayloads: { arguments: ['exec'], files: [] },
  binding: {
    protocolDriverId: 'native/stdio-v1',
    resultParserId: 'codex-jsonl/v1',
    permissionStrategyId: 'codex-cli/v1',
    delivery: { prompt: 'argument', resultSchema: 'argument', result: 'stdout' },
  },
  bindingToken: bindingToken(),
  ...overrides,
});

test('copies stdin and file prepared payload material for launch finalization', () => {
  const stdin = new TextEncoder().encode('Return JSON.');
  const promptBytes = new TextEncoder().encode('prompt bytes');
  const schemaBytes = new TextEncoder().encode('{"type":"object"}');
  const candidate = preparedLaunchCandidate({
    preparedPayloads: {
      arguments: ['exec', '--schema', '{"type":"object"}'],
      stdin,
      files: [
        {
          kind: 'prompt',
          path: '/outputs/invocation/.scratch/prompt.txt',
          bytes: promptBytes,
        },
        {
          kind: 'result-schema',
          path: '/outputs/invocation/.scratch/result-schema.json',
          bytes: schemaBytes,
        },
      ],
    },
  });

  const prepared = PreparedLaunch.create(candidate);
  if (prepared === undefined) throw new Error('Expected prepared launch evidence');
  stdin[0] = 0;
  promptBytes[0] = 0;
  schemaBytes[0] = 0;

  expect(prepared.preparedPayloads).toEqual({
    arguments: ['exec', '--schema', '{"type":"object"}'],
    stdin: new TextEncoder().encode('Return JSON.'),
    files: [
      {
        kind: 'prompt',
        path: '/outputs/invocation/.scratch/prompt.txt',
        bytes: new TextEncoder().encode('prompt bytes'),
      },
      {
        kind: 'result-schema',
        path: '/outputs/invocation/.scratch/result-schema.json',
        bytes: new TextEncoder().encode('{"type":"object"}'),
      },
    ],
  });
  expect(Object.isFrozen(prepared.preparedPayloads)).toBe(true);
  expect(Object.isFrozen(prepared.preparedPayloads.arguments)).toBe(true);
  expect(Object.isFrozen(prepared.preparedPayloads.files)).toBe(true);
  expect(Object.isFrozen(prepared.preparedPayloads.files[0])).toBe(true);
});

test('keeps prepared payload material out of enumerable launch views', () => {
  const prepared = PreparedLaunch.create(
    preparedLaunchCandidate({
      preparedPayloads: {
        arguments: ['exec', 'raw prompt'],
        stdin: new TextEncoder().encode('stdin prompt'),
        files: [
          {
            kind: 'prompt',
            path: '/outputs/invocation/.scratch/prompt.txt',
            bytes: new TextEncoder().encode('file prompt'),
          },
        ],
      },
    }),
  );
  if (prepared === undefined) throw new Error('Expected prepared launch evidence');

  expect(Object.getOwnPropertyDescriptor(prepared, 'preparedPayloads')).toMatchObject({
    enumerable: false,
    writable: false,
    configurable: false,
  });
  const enumerableViews = [Object.keys(prepared).join('\n'), JSON.stringify(prepared)];
  for (const view of enumerableViews) {
    expect(view).not.toContain('raw prompt');
    expect(view).not.toContain('stdin prompt');
    expect(view).not.toContain('file prompt');
  }
});

test('rejects malformed prepared payload finalization material', () => {
  const sparseFiles = [
    {
      kind: 'prompt',
      path: '/outputs/invocation/.scratch/prompt.txt',
      bytes: new TextEncoder().encode('prompt'),
    },
  ];
  Object.defineProperty(sparseFiles, 'extra', { value: true, enumerable: true });

  for (const preparedPayloads of [
    null,
    [],
    { arguments: ['exec'] },
    { files: [] },
    { arguments: ['exec'], files: 'not-files' },
    { arguments: ['exec'], files: sparseFiles },
    { arguments: ['exec'], stdin: 'not-bytes', files: [] },
    {
      arguments: ['exec'],
      files: [
        {
          kind: 'stdout',
          path: '/outputs/invocation/.scratch/prompt.txt',
          bytes: new TextEncoder().encode('prompt'),
        },
      ],
    },
    {
      arguments: ['exec'],
      files: [
        {
          kind: 'prompt',
          path: '',
          bytes: new TextEncoder().encode('prompt'),
        },
      ],
    },
    {
      arguments: ['exec'],
      files: [
        {
          kind: 'prompt',
          path: '/outputs/invocation/.scratch/prompt.txt',
          bytes: 'not-bytes',
        },
      ],
    },
  ]) {
    expect(PreparedLaunch.create(preparedLaunchCandidate({ preparedPayloads }))).toBeUndefined();
  }
});
