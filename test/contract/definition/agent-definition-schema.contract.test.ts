import { expect, test } from 'vitest';

import {
  DefinitionValidationError,
  validateAgentDefinition,
} from '../../../src/definition/index.js';
import { agentDefinition } from '../../support/builders/agent-definition.js';
import { consumerSchemaDialect } from '../../support/builders/consumer-schema.js';

test('enforces UTF-8 field and complete-definition byte bounds', () => {
  const oversizedId = { ...agentDefinition(), id: 'x'.repeat(257) };
  const oversizedSchema = { ['x'.repeat(1_048_576)]: true };
  const oversizedDefinition = agentDefinition({ parameters: { schema: oversizedSchema } });
  const oversizedArguments = Array.from({ length: 4 }, () =>
    Object.freeze({ kind: 'literal', value: 'x'.repeat(262_144) }),
  );
  const oversizedCanonicalDefinition = agentDefinition({
    launch: { ...agentDefinition().launch, args: oversizedArguments },
  });

  expect(() => validateAgentDefinition(oversizedId)).toThrow(DefinitionValidationError);
  expect(() => validateAgentDefinition(oversizedDefinition)).toThrow(DefinitionValidationError);
  expect(() => validateAgentDefinition(oversizedCanonicalDefinition)).toThrow(
    DefinitionValidationError,
  );
});

test('requires the restricted JSON Schema 2020-12 profile for both input channels', () => {
  const accepted = agentDefinition({
    parameters: {
      schema: {
        $schema: consumerSchemaDialect,
        $defs: { count: { minimum: 0, type: 'number' } },
        properties: { count: { $ref: '#/$defs/count' }, root: { $ref: '#' }, unconstrained: true },
        type: 'object',
      },
    },
    permissions: {
      schema: {
        $schema: consumerSchemaDialect,
        properties: { write: { type: 'boolean' } },
        type: 'object',
      },
    },
  });

  expect(validateAgentDefinition(accepted).definition.id).toBe('codex');
  for (const definition of [
    agentDefinition({ parameters: { schema: { type: 'object' } } }),
    agentDefinition({
      permissions: {
        schema: { $schema: 'https://json-schema.org/draft/2019-09/schema', type: 'object' },
      },
    }),
    agentDefinition({
      parameters: {
        schema: { $schema: consumerSchemaDialect, title: 'not allowed', type: 'object' },
      },
    }),
    agentDefinition({
      parameters: {
        schema: {
          $schema: consumerSchemaDialect,
          properties: { value: { $schema: consumerSchemaDialect, type: 'string' } },
          type: 'object',
        },
      },
    }),
  ]) {
    expect(() => validateAgentDefinition(definition)).toThrow(DefinitionValidationError);
  }
});

test('rejects invalid consumer-schema local references and schema locations', () => {
  const invalidSchemas = [
    {
      $schema: consumerSchemaDialect,
      properties: { value: { $ref: 'https://example.test/schema' } },
      type: 'object',
    },
    {
      $schema: consumerSchemaDialect,
      properties: { value: { $ref: '#/$defs/missing' } },
      type: 'object',
    },
    {
      $schema: consumerSchemaDialect,
      properties: { value: { $ref: '#/%24defs/value' } },
      type: 'object',
    },
    { $schema: consumerSchemaDialect, properties: [] },
    { $schema: consumerSchemaDialect, additionalProperties: [] },
    { $schema: consumerSchemaDialect, items: [] },
    { $schema: consumerSchemaDialect, properties: { value: { $ref: 1 } }, type: 'object' },
    {
      $schema: consumerSchemaDialect,
      properties: { value: { $ref: '#/$defs/value', type: 'string' } },
      $defs: { value: true },
      type: 'object',
    },
    {
      $schema: consumerSchemaDialect,
      properties: { value: { $ref: '#/$defs/bad~2' } },
      type: 'object',
    },
    {
      $schema: consumerSchemaDialect,
      $defs: { value: { $ref: '#/$defs/value' } },
      $ref: '#/$defs/value',
    },
  ];

  for (const schema of invalidSchemas) {
    expect(() => validateAgentDefinition(agentDefinition({ parameters: { schema } }))).toThrow(
      DefinitionValidationError,
    );
  }
});

test('enforces consumer-schema resource bounds before definitions are sealed', () => {
  let deeplyNested: unknown = { type: 'string' };
  for (let index = 0; index < 64; index += 1) deeplyNested = { items: deeplyNested };
  const tooDeep = { $schema: consumerSchemaDialect, items: deeplyNested };
  const tooManyNodes = {
    $schema: consumerSchemaDialect,
    const: Array.from({ length: 8_192 }, () => true),
  };

  expect(() =>
    validateAgentDefinition({ ...agentDefinition(), parameters: { schema: tooDeep } }),
  ).toThrow(DefinitionValidationError);
  expect(() =>
    validateAgentDefinition(agentDefinition({ parameters: { schema: tooManyNodes } })),
  ).toThrow(DefinitionValidationError);
});

test('validates parameter and permission defaults with their consumer schemas', () => {
  const parameterSchema = {
    $schema: consumerSchemaDialect,
    properties: { retries: { minimum: 0, type: 'integer' } },
    required: ['retries'],
    type: 'object',
  };
  const permissionSchema = {
    $schema: consumerSchemaDialect,
    properties: { write: { type: 'boolean' } },
    required: ['write'],
    type: 'object',
  };

  expect(
    validateAgentDefinition(
      agentDefinition({
        parameters: { defaults: { retries: 1 }, schema: parameterSchema },
        permissions: { defaults: { write: false }, schema: permissionSchema },
      }),
    ).definition.id,
  ).toBe('codex');
  expect(
    validateAgentDefinition(
      agentDefinition({
        parameters: {
          defaults: { value: 1 },
          schema: {
            $schema: consumerSchemaDialect,
            properties: { value: { type: ['string', 'number'] } },
            required: ['value'],
            type: 'object',
          },
        },
      }),
    ).definition.parameters.defaults,
  ).toEqual({ value: 1 });
  for (const definition of [
    agentDefinition({ parameters: { defaults: { retries: -1 }, schema: parameterSchema } }),
    agentDefinition({ permissions: { defaults: { write: 'yes' }, schema: permissionSchema } }),
    agentDefinition({
      parameters: {
        defaults: {},
        schema: { $schema: consumerSchemaDialect, multipleOf: 0, type: 'number' },
      },
    }),
  ]) {
    expect(() => validateAgentDefinition(definition)).toThrow(DefinitionValidationError);
  }
});

test('enforces the version-probe argv budget and rejects retired executable-version constraints', () => {
  const probeArgs = Array.from({ length: 5 }, () => 'x'.repeat(210_000));
  const oversizedProbe = agentDefinition({
    launch: {
      ...agentDefinition().launch,
      versionProbe: { args: probeArgs, stream: 'stdout', timeoutMs: 1_000 },
    },
  });

  expect(() => validateAgentDefinition(oversizedProbe)).toThrow(DefinitionValidationError);
  expect(() =>
    validateAgentDefinition({
      ...agentDefinition(),
      constraints: { executableVersion: '>=1.2.3' },
    }),
  ).toThrow(DefinitionValidationError);
});
