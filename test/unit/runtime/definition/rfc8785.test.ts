import { readFile } from 'node:fs/promises';

import { afterEach, expect, test, vi } from 'vitest';

import { canonicalizeJsonBytes } from '../../../../src/runtime/definition/index.js';
import { AGENT_FAULT_MESSAGES } from '../../../../src/runtime/policy/index.js';
import type { AgentFault, JsonValue } from '../../../../src/runtime/spec/index.js';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const rfcInputBytes = textEncoder.encode(
  '{\n' +
    '  "numbers": [333333333.33333329, 1E30, 4.50, 2e-3, 0.000000000000000000000000001],\n' +
    '  "string": "\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/",\n' +
    '  "literals": [null, true, false]\n' +
    '}\n',
);

const rfcExpectedHex =
  '7b226c69746572616c73223a5b6e756c6c2c747275652c66616c73655d2c226e756d62657273223a5b3333333333333333332e333333333333332c31652b33302c342e352c302e3030322c31652d32375d2c22737472696e67223a22e282ac245c75303030665c6e4127425c225c5c5c5c5c222f227d';

const internalFault: AgentFault = {
  code: 'revo.agent.internal',
  message: AGENT_FAULT_MESSAGES.internalConstruction,
  phase: 'construction',
  retryable: false,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isJsonValue = (value: unknown): value is JsonValue => {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  )
    return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== 'object') return false;

  return Object.values(value).every(isJsonValue);
};

const expectToJsonShadow = (value: object): void => {
  expect(Object.getOwnPropertyDescriptor(value, 'toJSON')).toEqual({
    configurable: true,
    enumerable: false,
    value: undefined,
    writable: true,
  });
};

const expectDefinitionFault = (operation: () => unknown): void => {
  try {
    operation();
  } catch (error: unknown) {
    if (!(error instanceof Error) || error.name !== 'AgentManagerError') throw error;
    expect(Reflect.get(error, 'fault')).toMatchObject({ code: 'revo.agent.definition_invalid' });
    return;
  }

  throw new Error('Expected a definition validation fault');
};

const importDefinitionAdapter = async (): Promise<
  typeof import('../../../../src/runtime/definition/index.js')
> => import('../../../../src/runtime/definition/index.js');

afterEach(() => {
  vi.doUnmock('canonicalize');
  vi.resetModules();
});

test('canonicalizes the cited RFC 8785 vector into exact UTF-8 bytes', async () => {
  const inputFixture = await readFile(
    new URL('../../../fixtures/rfc8785/section-3.2.2.input.txt', import.meta.url),
  );
  const expectedFixture = await readFile(
    new URL('../../../fixtures/rfc8785/section-3.2.4.expected.txt', import.meta.url),
  );

  expect(new Uint8Array(inputFixture)).toEqual(rfcInputBytes);
  expect(inputFixture.includes(0x0d)).toBe(false);
  expect([...inputFixture.subarray(-1)]).toEqual([0x0a]);
  expect([...inputFixture.subarray(-2)]).not.toEqual([0x0a, 0x0a]);

  const input: unknown = JSON.parse(textDecoder.decode(inputFixture));
  if (!isJsonValue(input)) throw new Error('Expected the RFC fixture to parse as JSON.');
  const output = canonicalizeJsonBytes(input);

  expect(textDecoder.decode(output)).toBe(textDecoder.decode(expectedFixture.subarray(0, -1)));
  expect(Buffer.from(output).toString('hex')).toBe(rfcExpectedHex);
});

test('shadows inherited toJSON hooks on copied nested objects and arrays', async () => {
  const provider = vi.fn((value: unknown) => {
    if (!isRecord(value)) {
      throw new Error('Expected a copied root object.');
    }
    if (!Array.isArray(value.array) || !isRecord(value.object)) {
      throw new Error('Expected copied nested object and array values.');
    }
    if (!isRecord(value.array[0])) {
      throw new Error('Expected a copied object inside the nested array.');
    }

    expectToJsonShadow(value);
    expectToJsonShadow(value.object);
    expectToJsonShadow(value.array);
    expectToJsonShadow(value.array[0]);
    JSON.stringify(value);
    JSON.stringify(value.object);
    JSON.stringify(value.array);
    JSON.stringify(value.array[0]);
    return '{"copied":true}';
  });
  vi.resetModules();
  vi.doMock('canonicalize', () => ({ default: provider }));

  const { canonicalizeJsonBytes: mockedCanonicalizeJsonBytes } = await importDefinitionAdapter();
  const value: JsonValue = {
    object: { nested: true },
    array: [{ nested: true }],
  };
  const objectToJsonDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON');
  const arrayToJsonDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON');
  const defineProperty = Object.defineProperty;
  let objectToJsonCalls = 0;
  let arrayToJsonCalls = 0;

  try {
    defineProperty(Object.prototype, 'toJSON', {
      configurable: true,
      value: () => {
        objectToJsonCalls += 1;
        return {};
      },
    });
    defineProperty(Array.prototype, 'toJSON', {
      configurable: true,
      value: () => {
        arrayToJsonCalls += 1;
        return [];
      },
    });

    expect(textDecoder.decode(mockedCanonicalizeJsonBytes(value))).toBe('{"copied":true}');
    expect(provider).toHaveBeenCalledTimes(1);
    expect(objectToJsonCalls).toBe(0);
    expect(arrayToJsonCalls).toBe(0);
  } finally {
    if (objectToJsonDescriptor) defineProperty(Object.prototype, 'toJSON', objectToJsonDescriptor);
    else Reflect.deleteProperty(Object.prototype, 'toJSON');
    if (arrayToJsonDescriptor) defineProperty(Array.prototype, 'toJSON', arrayToJsonDescriptor);
    else Reflect.deleteProperty(Array.prototype, 'toJSON');
  }
});

test('rejects an own callable toJSON before invoking the provider', async () => {
  let calls = 0;
  const provider = vi.fn(() => '{"provider":true}');
  vi.resetModules();
  vi.doMock('canonicalize', () => ({ default: provider }));

  const { canonicalizeJsonBytes: mockedCanonicalizeJsonBytes } = await importDefinitionAdapter();
  const value = Object.defineProperty({} satisfies Record<string, JsonValue>, 'toJSON', {
    enumerable: true,
    value: () => {
      calls += 1;
      return {};
    },
  });

  expectDefinitionFault(() => mockedCanonicalizeJsonBytes(value));
  expect(calls).toBe(0);
  expect(provider).not.toHaveBeenCalled();
});

test('rejects an own toJSON accessor before invoking the provider', async () => {
  let calls = 0;
  const provider = vi.fn(() => '{"provider":true}');
  vi.resetModules();
  vi.doMock('canonicalize', () => ({ default: provider }));

  const { canonicalizeJsonBytes: mockedCanonicalizeJsonBytes } = await importDefinitionAdapter();
  const value = Object.defineProperty({} satisfies Record<string, JsonValue>, 'toJSON', {
    enumerable: true,
    get: () => {
      calls += 1;
      return () => ({});
    },
  });

  expectDefinitionFault(() => mockedCanonicalizeJsonBytes(value));
  expect(calls).toBe(0);
  expect(provider).not.toHaveBeenCalled();
});

test('preserves a legitimate own non-callable toJSON data key', () => {
  const value: JsonValue = { toJSON: 'ordinary data', value: true };

  expect(textDecoder.decode(canonicalizeJsonBytes(value))).toBe(
    '{"toJSON":"ordinary data","value":true}',
  );
});

test('preserves __proto__ as data without changing the copied prototype', () => {
  const value = Object.defineProperty({} satisfies Record<string, JsonValue>, '__proto__', {
    enumerable: true,
    value: 'ordinary data',
  });

  expect(textDecoder.decode(canonicalizeJsonBytes(value))).toBe('{"__proto__":"ordinary data"}');
});

test('accepts paired surrogates and rejects unpaired surrogates in keys and values', () => {
  expect(textDecoder.decode(canonicalizeJsonBytes({ '\uD83D\uDE00': '\uD83D\uDE00' }))).toBe(
    '{"😀":"😀"}',
  );

  expectDefinitionFault(() => canonicalizeJsonBytes({ value: '\uD800' }));
  const invalidKey = Object.defineProperty({} satisfies Record<string, JsonValue>, '\uD800', {
    enumerable: true,
    value: true,
  });
  expectDefinitionFault(() => canonicalizeJsonBytes(invalidKey));
});

test('returns fresh bytes isolated from later caller mutation', () => {
  const nested: JsonValue[] = [{ value: true }];
  const value: JsonValue = { nested };

  const output = canonicalizeJsonBytes(value);
  nested[0] = { value: false };
  nested.push({ another: true });

  expect(textDecoder.decode(output)).toBe('{"nested":[{"value":true}]}');
  expect(canonicalizeJsonBytes(value)).not.toBe(output);
});

test('maps an undefined canonicalize result to the sanitized internal fault', async () => {
  const provider = vi.fn(() => undefined);
  vi.resetModules();
  vi.doMock('canonicalize', () => ({ default: provider }));

  const { canonicalizeJsonBytes: mockedCanonicalizeJsonBytes } = await importDefinitionAdapter();

  try {
    mockedCanonicalizeJsonBytes({ value: true });
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    expect(error).toMatchObject({ name: 'AgentManagerError' });
    expect(Reflect.get(error, 'fault')).toEqual(internalFault);
    expect(provider).toHaveBeenCalledTimes(1);
    return;
  }

  throw new Error('Expected the mocked provider failure');
});

test('maps a thrown canonicalize error to the sanitized internal fault', async () => {
  const sentinel = new Error('canonicalize sentinel must not leak');
  const provider = vi.fn(() => {
    throw sentinel;
  });
  vi.resetModules();
  vi.doMock('canonicalize', () => ({ default: provider }));

  const { canonicalizeJsonBytes: mockedCanonicalizeJsonBytes } = await importDefinitionAdapter();

  try {
    mockedCanonicalizeJsonBytes({ value: true });
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    expect(error).toMatchObject({ name: 'AgentManagerError' });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(Reflect.get(error, 'fault')).toEqual(internalFault);
    expect(error).not.toBe(sentinel);
    expect(error.message).not.toContain(sentinel.message);
    expect(error.stack).not.toContain(sentinel.message);
    expect(Reflect.get(error, 'cause')).toBeUndefined();
    expect(JSON.stringify(Reflect.get(error, 'fault'))).not.toContain(sentinel.message);
    return;
  }

  throw new Error('Expected the mocked provider failure');
});
