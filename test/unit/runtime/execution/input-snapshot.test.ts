import { expect, test } from 'vitest';

import { InvocationInputSnapshot } from '../../../../src/runtime/execution/index.js';

const resultSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
};

const completeInput = (
  overrides: Readonly<Record<string, unknown>> = Object.freeze({}),
): Readonly<Record<string, unknown>> =>
  Object.freeze({
    invocationId: 'complete-input',
    agent: Object.freeze({ id: 'fixture-agent', version: '1.0.0' }),
    prompt: 'Return JSON.',
    workspace: Object.freeze({ directory: '/workspace/project' }),
    parameters: Object.freeze({}),
    permissions: Object.freeze({}),
    result: Object.freeze({ schema: resultSchema }),
    output: Object.freeze({ directory: '/outputs/invocation' }),
    ...overrides,
  });

test('copies and freezes caller metadata without retaining nested containers', () => {
  const nested = { values: [1, 2] };
  Object.defineProperty(nested, '__proto__', {
    value: 'data',
    enumerable: true,
    configurable: true,
  });
  const metadata = { nested };
  const snapshot = InvocationInputSnapshot.create(
    completeInput({
      invocationId: 'invocation-1',
      metadata,
      limits: { wallClockTimeoutMs: 1_000, idleTimeoutMs: 1_000 },
    }),
  );

  expect(snapshot).toBeDefined();
  if (snapshot === undefined) return;
  metadata.nested.values[0] = 99;
  Reflect.deleteProperty(metadata.nested, '__proto__');
  const copiedNested = snapshot.metadata?.nested;
  if (typeof copiedNested !== 'object' || copiedNested === null || Array.isArray(copiedNested))
    throw new Error('Expected copied nested record');
  expect(Object.getOwnPropertyDescriptor(copiedNested, 'values')?.value).toEqual([1, 2]);
  expect(Object.getOwnPropertyDescriptor(copiedNested, '__proto__')?.value).toBe('data');
  expect(Object.isFrozen(snapshot.metadata)).toBe(true);
  expect(Object.isFrozen(snapshot.metadata?.nested)).toBe(true);
  expect(Object.getPrototypeOf(snapshot.metadata?.nested)).toBeNull();
  expect(Object.prototype.hasOwnProperty.call(snapshot.metadata?.nested, '__proto__')).toBe(true);
});

test('rejects hostile and invalid snapshots without exposing an error', () => {
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  const accessor = {};
  Object.defineProperty(accessor, 'value', { enumerable: true, get: () => 1 });

  expect(InvocationInputSnapshot.create(completeInput({ invocationId: '' }))).toBeUndefined();
  expect(
    InvocationInputSnapshot.create(completeInput({ invocationId: 'id', metadata: cyclic })),
  ).toBeUndefined();
  expect(
    InvocationInputSnapshot.create(completeInput({ invocationId: 'id', metadata: accessor })),
  ).toBeUndefined();
  expect(
    InvocationInputSnapshot.create(completeInput({ invocationId: 'id', metadata: [1] })),
  ).toBeUndefined();
  expect(
    InvocationInputSnapshot.create(
      completeInput({ limits: { wallClockTimeoutMs: 999, idleTimeoutMs: 999 } }),
    ),
  ).toBeUndefined();
  expect(
    InvocationInputSnapshot.create(
      completeInput({ agent: { id: 'x'.repeat(257), version: '1.0.0' } }),
    ),
  ).toBeUndefined();
  expect(
    InvocationInputSnapshot.create({
      resultSchema,
      invocationId: 'id',
      agent: { id: 'agent', version: '\ud800' },
    }),
  ).toBeUndefined();
});

test('uses iterative copy and freezing for a deep byte-valid metadata graph', () => {
  let metadata: unknown = 'end';
  for (let index = 0; index < 2_000; index += 1) metadata = { next: metadata };

  const snapshot = InvocationInputSnapshot.create(
    completeInput({ invocationId: 'deep', metadata }),
  );
  expect(snapshot?.invocationId).toBe('deep');
  expect(snapshot?.wallClockTimeoutMs).toBe(1_800_000);
});

test('accepts transparent reflective Proxy views without retaining their source containers', () => {
  const nested = { value: 'before' };
  const metadata = new Proxy({ nested: new Proxy(nested, {}) }, {});
  const request = new Proxy(completeInput({ invocationId: 'proxy', metadata }), {});
  const snapshot = InvocationInputSnapshot.create(request);

  expect(snapshot?.metadata).toEqual({ nested: { value: 'before' } });
  nested.value = 'after';
  expect(snapshot?.metadata).toEqual({ nested: { value: 'before' } });
});

test('fails closed when reflective Proxy traps throw', () => {
  const metadata = new Proxy(
    {},
    {
      ownKeys: () => {
        throw new Error('hostile trap text');
      },
    },
  );

  expect(
    InvocationInputSnapshot.create(completeInput({ invocationId: 'proxy-trap', metadata })),
  ).toBeUndefined();
});

test('copies bounded workspace input without applying filesystem path policy', () => {
  const relative = InvocationInputSnapshot.create(
    completeInput({
      invocationId: 'relative-workspace',
      workspace: { directory: '../workspace/./pending\u0000' },
    }),
  );

  expect(relative?.workspace).toBe('../workspace/./pending\u0000');
  expect(
    InvocationInputSnapshot.create(
      completeInput({
        invocationId: 'oversized-workspace',
        workspace: { directory: 'x'.repeat(16_385) },
      }),
    ),
  ).toBeUndefined();
});

test('allows acyclic aliases while copying each occurrence independently', () => {
  const shared = { value: [1] };
  const snapshot = InvocationInputSnapshot.create(
    completeInput({ invocationId: 'alias', metadata: { left: shared, right: shared } }),
  );
  const metadata = snapshot?.metadata;
  if (
    metadata === undefined ||
    typeof metadata.left !== 'object' ||
    metadata.left === null ||
    Array.isArray(metadata.left) ||
    typeof metadata.right !== 'object' ||
    metadata.right === null ||
    Array.isArray(metadata.right)
  )
    throw new Error('Expected copied alias records');

  expect(metadata.left).toEqual({ value: [1] });
  expect(metadata.right).toEqual({ value: [1] });
  expect(metadata.left).not.toBe(metadata.right);
});

test('rejects oversized strings and collections during admission', () => {
  const wide: Record<string, number> = {};
  for (let index = 0; index <= 65_536; index += 1) wide[String(index)] = index;

  expect(
    InvocationInputSnapshot.create(
      completeInput({ invocationId: 'large-string', metadata: { value: 'x'.repeat(65_536) } }),
    ),
  ).toBeUndefined();
  expect(
    InvocationInputSnapshot.create(completeInput({ invocationId: 'wide', metadata: wide })),
  ).toBeUndefined();
});

test('matches JSON short-control escape bytes at the metadata boundary', () => {
  const shortEscapes = ['\b', '\t', '\n', '\f', '\r'];
  for (const escape of shortEscapes) {
    const metadata = { value: escape.repeat(20_000) };
    expect(new TextEncoder().encode(JSON.stringify(metadata)).byteLength).toBe(40_012);
    expect(
      InvocationInputSnapshot.create(
        completeInput({ invocationId: `short-${escape.charCodeAt(0)}`, metadata }),
      ),
    ).toBeDefined();
  }

  const atLimit = { value: '\n'.repeat(32_762) };
  const overLimit = { value: '\n'.repeat(32_763) };
  expect(new TextEncoder().encode(JSON.stringify(atLimit)).byteLength).toBe(65_536);
  expect(new TextEncoder().encode(JSON.stringify(overLimit)).byteLength).toBe(65_538);
  expect(
    InvocationInputSnapshot.create(completeInput({ invocationId: 'at-limit', metadata: atLimit })),
  ).toBeDefined();
  expect(
    InvocationInputSnapshot.create(
      completeInput({ invocationId: 'over-limit', metadata: overLimit }),
    ),
  ).toBeUndefined();
});

test('rejects an oversized invocation id before bounded validation and encoding', () => {
  expect(
    InvocationInputSnapshot.create(completeInput({ invocationId: 'x'.repeat(257) })),
  ).toBeUndefined();
  expect(
    InvocationInputSnapshot.create(completeInput({ invocationId: '😀'.repeat(129) })),
  ).toBeUndefined();
});

test('rejects nested sparse arrays, non-finite values, and accessor-producing reflective views', () => {
  const sparse: unknown[] = [];
  sparse[1] = 'value';
  const accessorView = new Proxy(
    {},
    {
      ownKeys: () => ['value'],
      getOwnPropertyDescriptor: () => ({ enumerable: true, get: () => 'value' }),
    },
  );

  expect(
    InvocationInputSnapshot.create(completeInput({ invocationId: 'sparse', metadata: { sparse } })),
  ).toBeUndefined();
  expect(
    InvocationInputSnapshot.create(
      completeInput({ invocationId: 'infinite', metadata: { value: Infinity } }),
    ),
  ).toBeUndefined();
  expect(
    InvocationInputSnapshot.create(
      completeInput({ invocationId: 'accessor', metadata: accessorView }),
    ),
  ).toBeUndefined();
});

test('rejects an oversized metadata key and deep over-budget graph while traversing', () => {
  const oversizedKey = 'k'.repeat(65_536);
  const deep: { next: unknown } = { next: null };
  let cursor = deep;
  for (let index = 0; index < 10_000; index += 1) {
    const next = { next: null };
    cursor.next = next;
    cursor = next;
  }

  expect(
    InvocationInputSnapshot.create(
      completeInput({ invocationId: 'large-key', metadata: { [oversizedKey]: 1 } }),
    ),
  ).toBeUndefined();
  expect(
    InvocationInputSnapshot.create(
      completeInput({ invocationId: 'deep-over-budget', metadata: deep }),
    ),
  ).toBeUndefined();
});

test('accounts astral Unicode scalars like JSON serialization', () => {
  const metadata = { key: '😀' };
  const serializedBytes = new TextEncoder().encode(JSON.stringify(metadata)).byteLength;
  expect(serializedBytes).toBe(14);
  expect(
    InvocationInputSnapshot.create(completeInput({ invocationId: 'astral-😀', metadata })),
  ).toBeDefined();
});

test('rejects lone surrogates in invocation ids and metadata keys or values', () => {
  for (const surrogate of ['\ud800', '\udc00']) {
    expect(
      InvocationInputSnapshot.create(completeInput({ invocationId: surrogate })),
    ).toBeUndefined();
    expect(
      InvocationInputSnapshot.create(
        completeInput({ invocationId: 'metadata-value', metadata: { value: surrogate } }),
      ),
    ).toBeUndefined();
    expect(
      InvocationInputSnapshot.create(
        completeInput({ invocationId: 'metadata-key', metadata: { [surrogate]: 'value' } }),
      ),
    ).toBeUndefined();
  }
});

test('rejects each missing required public invocation field at snapshot admission', () => {
  const complete = {
    invocationId: 'missing-required-field',
    agent: { id: 'fixture-agent', version: '1.0.0' },
    prompt: 'Return JSON.',
    workspace: { directory: '/workspace/project' },
    parameters: {},
    permissions: {},
    result: { schema: resultSchema },
    output: { directory: '/outputs/invocation' },
  };

  for (const key of [
    'agent',
    'prompt',
    'workspace',
    'parameters',
    'permissions',
    'result',
    'output',
  ]) {
    const candidate: Record<string, unknown> = { ...complete };
    Reflect.deleteProperty(candidate, key);
    expect(InvocationInputSnapshot.create(candidate), key).toBeUndefined();
  }
});

test('rejects each malformed required public invocation field at snapshot admission', () => {
  const complete = {
    invocationId: 'malformed-required-field',
    agent: { id: 'fixture-agent', version: '1.0.0' },
    prompt: 'Return JSON.',
    workspace: { directory: '/workspace/project' },
    parameters: {},
    permissions: {},
    result: { schema: resultSchema },
    output: { directory: '/outputs/invocation' },
  };

  for (const [key, value] of [
    ['agent', { id: 'fixture-agent' }],
    ['prompt', ''],
    ['workspace', {}],
    ['parameters', []],
    ['permissions', []],
    ['result', {}],
    ['output', {}],
  ] as const) {
    expect(InvocationInputSnapshot.create({ ...complete, [key]: value }), key).toBeUndefined();
  }
});

test('rejects legacy top-level request keys on an otherwise complete public invocation shape', () => {
  expect(
    InvocationInputSnapshot.create(
      completeInput({
        resultSchema,
      }),
    ),
  ).toBeUndefined();
  expect(
    InvocationInputSnapshot.create(
      completeInput({
        wallClockTimeoutMs: 1_000,
      }),
    ),
  ).toBeUndefined();
});

test('rejects non-enumerable and symbol top-level request keys', () => {
  for (const [key, value] of [
    ['resultSchema', resultSchema],
    ['wallClockTimeoutMs', 1_000],
    ['legacyField', 'legacy'],
  ] as const) {
    const input = { ...completeInput({ invocationId: `non-enumerable-${key}` }) };
    Object.defineProperty(input, key, { value, enumerable: false });

    expect(InvocationInputSnapshot.create(input), key).toBeUndefined();
  }

  const symbol = Symbol('legacy');
  const input = { ...completeInput({ invocationId: 'symbol-key' }), [symbol]: 'legacy' };

  expect(InvocationInputSnapshot.create(input)).toBeUndefined();
});

test('defensively snapshots the complete public invocation request shape', () => {
  const parameters = { nested: { value: ['initial'] } };
  const permissions = { mode: 'workspace-write' };
  const schema = { ...resultSchema, properties: { ok: { type: 'boolean' } } };
  const input = {
    invocationId: 'complete-public-shape',
    agent: { id: 'fixture-agent', version: '1.0.0' },
    prompt: 'Return JSON.',
    workspace: { directory: '/workspace/project' },
    parameters,
    permissions,
    metadata: { trace: 'metadata' },
    result: { schema },
    limits: { wallClockTimeoutMs: 1_000, idleTimeoutMs: 1_000 },
    output: { directory: '/outputs/invocation' },
  };

  const snapshot = InvocationInputSnapshot.create(input);

  expect(snapshot).toMatchObject({
    invocationId: 'complete-public-shape',
    agent: { id: 'fixture-agent', version: '1.0.0' },
    prompt: 'Return JSON.',
    workspace: '/workspace/project',
    outputDirectory: '/outputs/invocation',
    parameters: { nested: { value: ['initial'] } },
    permissions: { mode: 'workspace-write' },
    metadata: { trace: 'metadata' },
    resultSchema: schema,
    limits: {
      wallClockTimeoutMs: 1_000,
      idleTimeoutMs: 1_000,
      maxEventBytes: 65_536,
      maxEventsFileBytes: 16_777_216,
      maxStdoutBytes: 8_388_608,
      maxStderrBytes: 8_388_608,
      maxRawResponseBytes: 1_048_576,
    },
    wallClockTimeoutMs: 1_000,
  });

  parameters.nested.value[0] = 'mutated';
  permissions.mode = 'mutated';
  schema.properties.ok.type = 'string';

  expect(snapshot).toMatchObject({
    parameters: { nested: { value: ['initial'] } },
    permissions: { mode: 'workspace-write' },
    resultSchema: { ...resultSchema, properties: { ok: { type: 'boolean' } } },
  });
  expect(Object.isFrozen(snapshot)).toBe(true);
  expect(Object.isFrozen(snapshot?.parameters)).toBe(true);
  expect(Object.isFrozen(snapshot?.permissions)).toBe(true);
  expect(Object.isFrozen(snapshot?.resultSchema)).toBe(true);
});

test('rejects incomplete or invalid complete invocation snapshot fields before preclaim work', () => {
  const complete = {
    invocationId: 'complete-public-shape',
    agent: { id: 'fixture-agent', version: '1.0.0' },
    prompt: 'Return JSON.',
    workspace: { directory: '/workspace/project' },
    parameters: {},
    permissions: {},
    result: { schema: resultSchema },
    output: { directory: '/outputs/invocation' },
  };

  expect(InvocationInputSnapshot.create({ ...complete, prompt: '' })).toBeUndefined();
  expect(InvocationInputSnapshot.create({ ...complete, parameters: [] })).toBeUndefined();
  expect(InvocationInputSnapshot.create({ ...complete, result: { schema: [] } })).toBeUndefined();
  expect(
    InvocationInputSnapshot.create({ ...complete, output: { directory: '' } }),
  ).toBeUndefined();
  expect(
    InvocationInputSnapshot.create({
      ...complete,
      limits: { maxRawResponseBytes: 1_048_577 },
    }),
  ).toBeUndefined();
});

test('derives effective invocation limits from a supplied manager default ceiling', () => {
  const complete = completeInput({
    invocationId: 'manager-ceiling',
    limits: { maxRawResponseBytes: 262_144 },
  });
  const managerLimits = {
    wallClockTimeoutMs: 60_000,
    idleTimeoutMs: 30_000,
    maxEventBytes: 32_768,
    maxEventsFileBytes: 4_194_304,
    maxStdoutBytes: 1_048_576,
    maxStderrBytes: 1_048_576,
    maxRawResponseBytes: 262_144,
  };

  expect(InvocationInputSnapshot.create({ ...complete, limits: {} }, managerLimits)).toMatchObject({
    limits: managerLimits,
    wallClockTimeoutMs: 60_000,
  });
  expect(
    InvocationInputSnapshot.create(
      { ...complete, limits: { maxRawResponseBytes: 262_145 } },
      managerLimits,
    ),
  ).toBeUndefined();
});
