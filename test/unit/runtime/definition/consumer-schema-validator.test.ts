import { expect, test } from 'vitest';

import { compileConsumerSchema } from '../../../../src/runtime/definition/index.js';
import { AgentManagerError } from '../../../../src/runtime/errors/index.js';
import type {
  AgentValidationDetails,
  JsonObject,
  JsonSchema202012,
  JsonValue,
} from '../../../../src/runtime/spec/index.js';

const dialect = 'https://json-schema.org/draft/2020-12/schema';
const schemaPath = '/definitions/0/parameters/schema';
const valuePath = '/definitions/0/parameters/defaults';

const schema = (body: JsonObject): JsonSchema202012 => ({ $schema: dialect, ...body });

const messages = {
  additionalProperties: 'Object must not contain additional properties.',
  const: 'Value must equal the schema constant.',
  enum: 'Value must equal one of the allowed schema values.',
  exclusiveMaximum: 'Number must be less than the exclusive maximum.',
  exclusiveMinimum: 'Number must be greater than the exclusive minimum.',
  false_schema: 'Value is rejected by the schema.',
  maximum: 'Number exceeds the allowed maximum.',
  maxItems: 'Array contains more items than allowed.',
  maxLength: 'String contains more characters than allowed.',
  minimum: 'Number is below the allowed minimum.',
  minItems: 'Array contains fewer items than required.',
  minLength: 'String contains fewer characters than required.',
  multipleOf: 'Number must be a multiple of the schema value.',
  required: 'Object is missing a required property.',
  schema_compile: 'Schema could not be compiled.',
  type: 'Value does not match the schema type.',
  uniqueItems: 'Array items must be unique.',
} as const;

type Keyword = keyof typeof messages;

const details = (
  keyword: Keyword,
  instancePath: string,
  schemaPathValue: string,
): AgentValidationDetails =>
  Object.freeze({
    diagnostics: Object.freeze([
      Object.freeze({
        instancePath,
        instancePathTruncated: false,
        schemaPath: schemaPathValue,
        schemaPathTruncated: false,
        keyword,
        message: messages[keyword],
      }),
    ]),
    truncated: false,
  });

test('compiles an admitted schema and returns undefined for a valid default value', () => {
  const compiled = compileConsumerSchema(
    schema({
      type: 'object',
      properties: { enabled: { type: 'boolean', default: true } },
      additionalProperties: false,
    }),
    schemaPath,
  );

  expect(Object.isFrozen(compiled)).toBe(true);
  expect(Object.keys(compiled)).toEqual(['validate']);
  expect(compiled.validate({ enabled: true }, valuePath)).toBeUndefined();
});

test('accepts a value missing a nonrequired default without mutating it', () => {
  const compiled = compileConsumerSchema(
    schema({
      type: 'object',
      properties: { enabled: { type: 'boolean', default: true } },
      additionalProperties: false,
    }),
    schemaPath,
  );
  const value: JsonValue = {};
  const before = structuredClone(value);

  expect(compiled.validate(value, valuePath)).toBeUndefined();
  expect(value).toStrictEqual(before);
  expect(Object.getOwnPropertyDescriptors(value)).toEqual(Object.getOwnPropertyDescriptors(before));
});

test('maps a boolean subschema failure without exposing Ajv parameters', () => {
  const compiled = compileConsumerSchema(
    schema({ type: 'object', properties: { denied: false } }),
    schemaPath,
  );

  expect(compiled.validate({ denied: null }, valuePath)).toEqual(
    details('false_schema', `${valuePath}/denied`, '/properties/denied/false schema'),
  );
  expect(JSON.stringify(compiled.validate({ denied: null }, valuePath))).not.toContain('params');
});

test.each([
  [
    'additionalProperties',
    schema({ type: 'object', additionalProperties: false }),
    { extra: true },
    '',
    '/additionalProperties',
  ],
  ['const', schema({ const: 'allowed' }), 'actual', '', '/const'],
  ['enum', schema({ enum: ['allowed'] }), 'actual', '', '/enum'],
  ['exclusiveMaximum', schema({ type: 'number', exclusiveMaximum: 1 }), 1, '', '/exclusiveMaximum'],
  ['exclusiveMinimum', schema({ type: 'number', exclusiveMinimum: 1 }), 1, '', '/exclusiveMinimum'],
  ['maximum', schema({ type: 'number', maximum: 1 }), 2, '', '/maximum'],
  ['maxItems', schema({ type: 'array', maxItems: 1 }), [1, 2], '', '/maxItems'],
  ['maxLength', schema({ type: 'string', maxLength: 1 }), 'ab', '', '/maxLength'],
  ['minimum', schema({ type: 'number', minimum: 1 }), 0, '', '/minimum'],
  ['minItems', schema({ type: 'array', minItems: 1 }), [], '', '/minItems'],
  ['minLength', schema({ type: 'string', minLength: 1 }), '', '', '/minLength'],
  ['multipleOf', schema({ type: 'number', multipleOf: 2 }), 3, '', '/multipleOf'],
  [
    'required',
    schema({ type: 'object', properties: { required: true }, required: ['required'] }),
    {},
    '',
    '/required',
  ],
  ['type', schema({ type: 'string' }), 1, '', '/type'],
  ['uniqueItems', schema({ type: 'array', uniqueItems: true }), [1, 1], '', '/uniqueItems'],
] as const)(
  'maps the %s mismatch to package-owned diagnostics',
  (keyword, valueSchema, value, instanceSuffix, schemaSuffix) => {
    const compiled = compileConsumerSchema(valueSchema, schemaPath);

    expect(compiled.validate(value, valuePath)).toEqual(
      details(keyword, `${valuePath}${instanceSuffix}`, schemaSuffix),
    );
  },
);

test('sorts and retains the first sixteen diagnostics from twenty mismatches', () => {
  const compiled = compileConsumerSchema(
    schema({
      type: 'object',
      properties: Object.fromEntries(
        Array.from({ length: 20 }, (_, index) => [
          `p${String(index).padStart(2, '0')}`,
          { type: 'string' },
        ]),
      ),
    }),
    schemaPath,
  );
  const value = Object.fromEntries(
    Array.from({ length: 20 }, (_, index) => [`p${String(index).padStart(2, '0')}`, index]),
  );

  const result = compiled.validate(value, valuePath);

  expect(result?.truncated).toBe(true);
  expect(result?.diagnostics.map((diagnostic) => diagnostic.instancePath)).toEqual(
    Array.from({ length: 16 }, (_, index) => `${valuePath}/p${String(index).padStart(2, '0')}`),
  );
});

test('uses only own properties and never coerces, defaults, removes, or mutates the value', () => {
  const compiled = compileConsumerSchema(
    schema({
      type: 'object',
      required: ['inherited', 'count'],
      properties: { inherited: { type: 'boolean' }, count: { type: 'integer', default: 1 } },
      additionalProperties: false,
    }),
    schemaPath,
  );
  const value: JsonValue = { count: '1', unexpected: true };
  Object.setPrototypeOf(value, { inherited: true });
  const before = structuredClone(value);

  const result = compiled.validate(value, valuePath);

  expect(result?.diagnostics.map((diagnostic) => diagnostic.keyword)).toEqual(
    expect.arrayContaining(['required', 'type', 'additionalProperties']),
  );
  expect(value).toEqual(before);
  expect(Object.getPrototypeOf(value)).toEqual({ inherited: true });
  expect(Object.hasOwn(value, 'inherited')).toBe(false);
});

test('reuses a compiled validator without retaining prior value bases or diagnostics', () => {
  const compiled = compileConsumerSchema(
    schema({ type: 'object', properties: { count: { type: 'integer' } } }),
    schemaPath,
  );
  const parameterPath = '/definitions/0/parameters/defaults';
  const permissionPath = '/definitions/0/permissions/defaults';

  const parameterDetails = compiled.validate({ count: '1' }, parameterPath);
  const permissionDetails = compiled.validate({ count: '2' }, permissionPath);

  expect(parameterDetails?.diagnostics[0]?.instancePath).toBe(`${parameterPath}/count`);
  expect(permissionDetails?.diagnostics[0]?.instancePath).toBe(`${permissionPath}/count`);
  expect(compiled.validate({ count: 1 }, permissionPath)).toBeUndefined();
  expect(Object.isFrozen(parameterDetails)).toBe(true);
  expect(Object.isFrozen(parameterDetails?.diagnostics)).toBe(true);
  expect(Object.isFrozen(parameterDetails?.diagnostics[0])).toBe(true);
});

test.each([
  [schema({ type: 'raw-schema-marker' }), '/definitions/0/parameters/schema'],
  [schema({ type: 'raw-schema-marker' }), '/definitions/0/permissions/schema'],
  [schema({ $ref: '#/$defs/raw-ref-marker', $defs: {} }), '/definitions/0/permissions/schema'],
] as const)(
  'sanitizes compilation failures at the supplied schema location',
  (invalidSchema, location) => {
    let error: unknown;
    try {
      compileConsumerSchema(invalidSchema, location);
    } catch (caught: unknown) {
      error = caught;
    }

    expect(error).toBeInstanceOf(AgentManagerError);
    if (!(error instanceof AgentManagerError)) throw new Error('Expected an AgentManagerError.');

    expect(error.fault).toEqual({
      code: 'revo.agent.definition_invalid',
      message: 'Agent definition is invalid.',
      phase: 'construction',
      retryable: false,
      details: details('schema_compile', location, '/schema_compile'),
    });
    expect(error.cause).toBeUndefined();
    for (const forbidden of [
      'raw-schema-marker',
      'raw-ref-marker',
      'schema is invalid',
      "can't resolve reference",
      'Ajv',
      'MissingRefError',
    ]) {
      expect(JSON.stringify(error)).not.toContain(forbidden);
      expect(error.stack).not.toContain(forbidden);
    }
  },
);
