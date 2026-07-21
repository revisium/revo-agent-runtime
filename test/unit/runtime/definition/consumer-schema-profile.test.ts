import { expect, test } from 'vitest';

import {
  canonicalizeJsonBytes,
  inspectPlainJson,
  validateConsumerSchemaProfile,
  type ConsumerSchemaProfileValidation,
} from '../../../../src/runtime/definition/index.js';
import { AgentManagerError } from '../../../../src/runtime/errors/index.js';
import { AGENT_RUNTIME_LIMITS } from '../../../../src/runtime/policy/index.js';
import type {
  AgentValidationDetails,
  JsonObject,
  JsonSchema202012,
  JsonValue,
} from '../../../../src/runtime/spec/index.js';

const instancePath = '/definitions/0/parameters/schema';
const dialect = 'https://json-schema.org/draft/2020-12/schema';

const diagnosticMessages = {
  keyword_allowlist: 'Keyword is not allowed by the consumer-schema profile.',
  ref_acyclic: 'Local reference graph must be acyclic.',
  ref_local: 'Reference must be local to the root schema.',
  ref_pointer: 'Reference must use an unencoded valid JSON Pointer fragment.',
  ref_resolved: 'Reference must resolve to a schema location.',
  ref_siblings: 'Reference schema contains forbidden sibling keywords.',
  root_dialect: 'Schema dialect must be declared exactly at the root.',
  schema_bytes: 'Schema canonical UTF-8 representation exceeds 1 MiB.',
  schema_depth: 'Schema JSON depth exceeds 64.',
  schema_location: 'Value must be a boolean or object consumer schema.',
  schema_nodes: 'Schema JSON node count exceeds 8,192.',
} as const;

type DiagnosticKeyword = keyof typeof diagnosticMessages;
type ExpectedDiagnostic = readonly [keyword: DiagnosticKeyword, path: string];

const root = (body: JsonObject): JsonObject => ({ $schema: dialect, ...body });

const invalidDiagnostics = (
  diagnostics: readonly ExpectedDiagnostic[],
  truncated = false,
): ConsumerSchemaProfileValidation =>
  Object.freeze({
    valid: false as const,
    diagnostics: Object.freeze({
      diagnostics: Object.freeze([
        ...diagnostics.map(([keyword, path]) =>
          Object.freeze({
            instancePath: path,
            instancePathTruncated: false,
            schemaPath: `/${keyword}`,
            schemaPathTruncated: false,
            keyword,
            message: diagnosticMessages[keyword],
          }),
        ),
      ]),
      truncated,
    }) satisfies AgentValidationDetails,
  });

const invalid = (
  keyword: DiagnosticKeyword,
  path = instancePath,
): ConsumerSchemaProfileValidation => invalidDiagnostics([[keyword, path]]);

const valid = (schema: JsonSchema202012): ConsumerSchemaProfileValidation =>
  Object.freeze({ valid: true as const, schema });

const nestedArrays = (count: number): JsonValue => {
  let value: JsonValue = true;
  for (let index = 0; index < count; index += 1) value = [value];
  return value;
};

const resourceBytesSchema = (size: number): JsonObject => {
  const base = root({ const: '' });
  const fillerLength = size - canonicalizeJsonBytes(base).byteLength;
  if (fillerLength < 0)
    throw new Error('Expected the requested byte size to include the schema overhead.');

  return root({ const: 'a'.repeat(fillerLength) });
};

test.each([
  ['unknown keyword', root({ title: 'x' }), 'keyword_allowlist', `${instancePath}/title`],
  [
    'nested dialect',
    root({ properties: { x: { $schema: dialect } } }),
    'root_dialect',
    `${instancePath}/properties/x/$schema`,
  ],
  [
    'remote reference',
    root({ $ref: 'https://example.test/schema' }),
    'ref_local',
    `${instancePath}/$ref`,
  ],
  [
    'percent-encoded reference',
    root({ $ref: '#/%24defs/x' }),
    'ref_pointer',
    `${instancePath}/$ref`,
  ],
  [
    'invalid pointer escape',
    root({ $ref: '#/$defs/~2x', $defs: { x: true } }),
    'ref_pointer',
    `${instancePath}/$ref`,
  ],
  [
    'unresolved reference',
    root({ $ref: '#/$defs/x', $defs: {} }),
    'ref_resolved',
    `${instancePath}/$ref`,
  ],
  [
    'reference cycle',
    root({ $ref: '#/$defs/x', $defs: { x: { $ref: '#' } } }),
    'ref_acyclic',
    `${instancePath}/$defs/x/$ref`,
  ],
  [
    'reference sibling',
    root({ $ref: '#', type: 'object' }),
    'ref_siblings',
    `${instancePath}/type`,
  ],
  ['invalid schema location', root({ items: 1 }), 'schema_location', `${instancePath}/items`],
  ['missing root dialect', { type: 'object' }, 'root_dialect', instancePath],
  ['boolean root', true, 'root_dialect', instancePath],
  ['array root', [], 'root_dialect', instancePath],
] as const)('rejects %s', (_name, schema, keyword, path) => {
  expect(validateConsumerSchemaProfile(schema, instancePath)).toEqual(invalid(keyword, path));
});

test.each([
  ['title', root({ title: 'x' }), `${instancePath}/title`],
  ['format', root({ type: 'string', format: 'email' }), `${instancePath}/format`],
  ['pattern', root({ type: 'string', pattern: '.*' }), `${instancePath}/pattern`],
  ['default', root({ default: 1 }), `${instancePath}/default`],
  ['legacy definitions', root({ definitions: {} }), `${instancePath}/definitions`],
] as const)(
  'rejects every required out-of-profile keyword with a full verdict: %s',
  (_name, schema, path) => {
    expect(validateConsumerSchemaProfile(schema, instancePath)).toEqual(
      invalid('keyword_allowlist', path),
    );
  },
);

test.each([
  root({ properties: { x: true }, additionalProperties: false }),
  root({
    properties: { a: { $ref: '#/$defs/shared' }, b: { $ref: '#/$defs/shared' } },
    $defs: { shared: { type: 'string' } },
  }),
  root({ $defs: { 'a~/b': { type: 'string' } }, properties: { x: { $ref: '#/$defs/a~0~1b' } } }),
  root({ properties: { type: { enum: ['x'] }, enum: { const: 'x' } } }),
  root({ $ref: '#/$defs/value', $defs: { value: { type: 'string' } } }),
  root({ properties: { value: { $ref: '#' } } }),
  root({ $defs: { self: { type: 'string' } }, properties: { self: { $ref: '#/$defs/self' } } }),
  root({
    type: 'object',
    enum: [],
    const: null,
    properties: {},
    required: [],
    additionalProperties: true,
    items: false,
    minLength: 0,
    maxLength: 1,
    minItems: 0,
    maxItems: 1,
    minimum: 0,
    maximum: 1,
    exclusiveMinimum: 0,
    exclusiveMaximum: 1,
    multipleOf: 1,
    uniqueItems: true,
  }),
] as const)('accepts an admitted consumer schema', (schema) => {
  const result = validateConsumerSchemaProfile(schema, instancePath);
  expect(result).toEqual(valid(schema));
  expect(Object.isFrozen(result)).toBe(true);
});

test('retains the caller root object on success', () => {
  const schema = root({ type: 'object' });
  const result = validateConsumerSchemaProfile(schema, instancePath);

  if (!result.valid) throw new Error('Expected an admitted schema.');
  expect(result.schema).toBe(schema);
});

test('rejects a nonroot reference sibling with a full verdict', () => {
  const schema = root({ properties: { value: { $ref: '#', type: 'string' } } });

  expect(validateConsumerSchemaProfile(schema, instancePath)).toEqual(
    invalid('ref_siblings', `${instancePath}/properties/value/type`),
  );
});

test('rejects a non-string reference with a full verdict', () => {
  const schema = root({ $ref: 1 });

  expect(validateConsumerSchemaProfile(schema, instancePath)).toEqual(
    invalid('ref_local', `${instancePath}/$ref`),
  );
});

test('rejects a root self-reference cycle with a full verdict', () => {
  const schema = root({ $ref: '#' });

  expect(validateConsumerSchemaProfile(schema, instancePath)).toEqual(
    invalid('ref_acyclic', `${instancePath}/$ref`),
  );
});

test('returns profile diagnostics before reference failures and cycles', () => {
  const schema = root({
    title: 'out-of-profile',
    $ref: 'https://example.test/schema',
    $defs: { self: { $ref: '#/$defs/self' } },
  });

  expect(validateConsumerSchemaProfile(schema, instancePath)).toEqual(
    invalid('keyword_allowlist', `${instancePath}/title`),
  );
});

test('returns reference diagnostics before cycle detection', () => {
  const schema = root({
    $ref: 'https://example.test/schema',
    $defs: { self: { $ref: '#/$defs/self' } },
  });

  expect(validateConsumerSchemaProfile(schema, instancePath)).toEqual(
    invalid('ref_local', `${instancePath}/$ref`),
  );
});

test('rejects a reference to a local value that is not a schema location', () => {
  const schema = root({ properties: { value: { $ref: '#/properties' } } });

  expect(validateConsumerSchemaProfile(schema, instancePath)).toEqual(
    invalid('ref_resolved', `${instancePath}/properties/value/$ref`),
  );
});

test('propagates an inspectPlainJson fault unchanged without invoking a hostile getter', () => {
  let getterCalls = 0;
  const schema = Object.defineProperty({}, '$schema', {
    enumerable: true,
    get: () => {
      getterCalls += 1;
      return dialect;
    },
  });
  const faultFrom = (operation: () => unknown): unknown => {
    try {
      operation();
    } catch (error: unknown) {
      if (error instanceof AgentManagerError) return error.fault;
      throw error;
    }

    throw new Error('Expected a plain-JSON inspection fault.');
  };

  expect(faultFrom(() => validateConsumerSchemaProfile(schema, instancePath))).toEqual(
    faultFrom(() => inspectPlainJson(schema, instancePath)),
  );
  expect(getterCalls).toBe(0);
});

test('short-circuits profile diagnostics after resource admission rejects', () => {
  const schema = root({ title: 'out-of-profile', const: nestedArrays(63) });

  expect(inspectPlainJson(schema, instancePath).depth).toBe(65);
  expect(validateConsumerSchemaProfile(schema, instancePath)).toEqual(invalid('schema_depth'));
});

test('normalizes multiple raw profile diagnostics into UTF-8 order', () => {
  const schema = root({
    properties: {
      '\u{10000}': { title: 'x' },
      '\uE000': { format: 'email' },
    },
  });

  expect(validateConsumerSchemaProfile(schema, instancePath)).toEqual(
    invalidDiagnostics([
      ['keyword_allowlist', `${instancePath}/properties/\uE000/format`],
      ['keyword_allowlist', `${instancePath}/properties/\u{10000}/title`],
    ]),
  );
});

test('bounds a deterministic profile diagnostic collection', () => {
  const schema = root({
    properties: Object.fromEntries(
      Array.from({ length: AGENT_RUNTIME_LIMITS.diagnosticCount + 1 }, (_, index) => [
        `x${String(index).padStart(2, '0')}`,
        { title: index },
      ]),
    ),
  });
  const expected = Array.from(
    { length: AGENT_RUNTIME_LIMITS.diagnosticCount },
    (_, index): ExpectedDiagnostic => [
      'keyword_allowlist',
      `${instancePath}/properties/x${String(index).padStart(2, '0')}/title`,
    ],
  );

  expect(validateConsumerSchemaProfile(schema, instancePath)).toEqual(
    invalidDiagnostics(expected, true),
  );
});

test.each([
  [64, root({ const: nestedArrays(62) }), true],
  [65, root({ const: nestedArrays(63) }), false],
] as const)('enforces schema depth boundary %i', (_depth, schema, admitted) => {
  expect(inspectPlainJson(schema, instancePath).depth).toBe(_depth);
  const result = validateConsumerSchemaProfile(schema, instancePath);
  expect(result).toEqual(admitted ? valid(schema) : invalid('schema_depth'));
});

test.each([
  [
    AGENT_RUNTIME_LIMITS.schemaNodes,
    root({ const: Array.from({ length: 8_189 }, () => true) }),
    true,
  ],
  [
    AGENT_RUNTIME_LIMITS.schemaNodes + 1,
    root({ const: Array.from({ length: 8_190 }, () => true) }),
    false,
  ],
] as const)('enforces schema node boundary %i', (_nodes, schema, admitted) => {
  expect(inspectPlainJson(schema, instancePath).nodes).toBe(_nodes);
  const result = validateConsumerSchemaProfile(schema, instancePath);
  expect(result).toEqual(admitted ? valid(schema) : invalid('schema_nodes'));
});

test.each([
  [AGENT_RUNTIME_LIMITS.schemaBytes, true],
  [AGENT_RUNTIME_LIMITS.schemaBytes + 1, false],
] as const)('enforces canonical byte boundary %i', (size, admitted) => {
  const schema = resourceBytesSchema(size);
  expect(canonicalizeJsonBytes(schema).byteLength).toBe(size);
  expect(validateConsumerSchemaProfile(schema, instancePath)).toEqual(
    admitted ? valid(schema) : invalid('schema_bytes'),
  );
});

test('returns a frozen normalized diagnostic verdict', () => {
  const result = validateConsumerSchemaProfile(root({ title: 'x' }), instancePath);

  if (result.valid) throw new Error('Expected a rejected schema.');
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.diagnostics)).toBe(true);
  expect(Object.isFrozen(result.diagnostics.diagnostics)).toBe(true);
});
