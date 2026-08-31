import { expect, test } from 'vitest';

import {
  DefinitionValidationError,
  validateAgentDefinition,
} from '../../../src/definition/index.js';
import { agentDefinition } from '../../support/builders/agent-definition.js';
import { consumerSchemaDialect } from '../../support/builders/consumer-schema.js';

const objectPrototype: object = Object.prototype;

const replaceInheritedToJson = (descriptor: PropertyDescriptor): void => {
  Reflect.defineProperty(objectPrototype, 'toJSON', descriptor);
};

const restoreInheritedToJson = (descriptor: PropertyDescriptor | undefined): void => {
  if (descriptor === undefined) Reflect.deleteProperty(objectPrototype, 'toJSON');
  else Reflect.defineProperty(objectPrototype, 'toJSON', descriptor);
};

test('rejects malformed plain JSON before it can be normalized', () => {
  const circular: Record<string, unknown> = { ...agentDefinition() };
  circular.parameters = circular;
  const accessor = { ...agentDefinition() };
  Object.defineProperty(accessor, 'id', { enumerable: true, get: () => 'codex' });
  const sparseArgs = [{ kind: 'literal', value: 'bridge.mjs' }];
  sparseArgs.length = 2;
  const accessorArg = [{ kind: 'literal', value: 'bridge.mjs' }];
  Object.defineProperty(accessorArg, '0', { enumerable: true, get: () => accessorArg[0] });
  const foreignArray = [{ kind: 'literal', value: 'bridge.mjs' }];
  Object.setPrototypeOf(foreignArray, null);
  const nonIndexedArrayProperty = [{ kind: 'literal', value: 'bridge.mjs' }];
  Object.defineProperty(nonIndexedArrayProperty, '01', { enumerable: true, value: 'unexpected' });
  const symbolKey = { ...agentDefinition(), [Symbol('unexpected')]: true };
  const proxied = new Proxy(agentDefinition(), {});

  for (const input of [
    null,
    [],
    undefined,
    Infinity,
    circular,
    accessor,
    symbolKey,
    proxied,
    { ...agentDefinition(), launch: { ...agentDefinition().launch, args: sparseArgs } },
    { ...agentDefinition(), launch: { ...agentDefinition().launch, args: accessorArg } },
    { ...agentDefinition(), launch: { ...agentDefinition().launch, args: foreignArray } },
    {
      ...agentDefinition(),
      launch: { ...agentDefinition().launch, args: nonIndexedArrayProperty },
    },
    { ...agentDefinition(), parameters: { schema: new Date() } },
  ]) {
    expect(() => validateAgentDefinition(input)).toThrow(DefinitionValidationError);
  }
});

test('does not execute own or inherited getters while validating JSON input', () => {
  let ownGetterCalls = 0;
  const ownGetter = { ...agentDefinition() };
  Object.defineProperty(ownGetter, 'id', {
    enumerable: true,
    get: () => {
      ownGetterCalls += 1;
      return 'codex';
    },
  });

  const originalToJson = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON');
  let inheritedGetterCalls = 0;
  try {
    replaceInheritedToJson({
      configurable: true,
      get: () => {
        inheritedGetterCalls += 1;
        return () => ({ polluted: true });
      },
    });

    expect(() => validateAgentDefinition(ownGetter)).toThrow(DefinitionValidationError);
    expect(validateAgentDefinition(agentDefinition()).definition.id).toBe('codex');
  } finally {
    restoreInheritedToJson(originalToJson);
  }

  expect(ownGetterCalls).toBe(0);
  expect(inheritedGetterCalls).toBe(0);
});

test('canonicalizes only enumerable own data when Object.prototype is polluted', () => {
  const expected = validateAgentDefinition(agentDefinition());
  const originalToJson = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON');

  try {
    replaceInheritedToJson({ configurable: true, value: () => ({ polluted: true }) });

    const validated = validateAgentDefinition(agentDefinition());
    expect(validated.digest).toBe(expected.digest);
    expect(validated.canonicalBytes()).toEqual(expected.canonicalBytes());
  } finally {
    restoreInheritedToJson(originalToJson);
  }
});

test('rejects unsupported Unicode and deeply nested JSON with a typed error', () => {
  let deeplyNested: unknown = { type: 'string' };
  for (let index = 0; index < 10_000; index += 1) deeplyNested = { items: deeplyNested };
  const deepSchema = {
    ...agentDefinition(),
    parameters: { schema: { $schema: consumerSchemaDialect, items: deeplyNested } },
  };

  for (const input of [
    agentDefinition({ id: '\ud800' }),
    agentDefinition({ id: '\udc00' }),
    agentDefinition({
      parameters: {
        schema: { $schema: consumerSchemaDialect, enum: ['\ud800'], type: 'string' },
      },
    }),
    agentDefinition({
      parameters: { schema: { $schema: consumerSchemaDialect, ['\ud800']: true, type: 'object' } },
    }),
    deepSchema,
  ]) {
    expect(() => validateAgentDefinition(input)).toThrow(DefinitionValidationError);
    expect(() => validateAgentDefinition(input)).not.toThrow(RangeError);
  }
});
