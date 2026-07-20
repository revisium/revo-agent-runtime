import { expect, test } from 'vitest';

import { inspectPlainJson } from '../../../../src/runtime/definition/index.js';
import { AgentManagerError } from '../../../../src/runtime/errors/index.js';
import {
  AGENT_FAULT_MESSAGES,
  AGENT_MANAGER_LIMITS,
  AGENT_RUNTIME_LIMITS,
} from '../../../../src/runtime/policy/index.js';
import type { AgentFault } from '../../../../src/runtime/spec/index.js';

const diagnosticMessages = {
  json_array_dense: 'Array must be dense and contain only indexed elements.',
  json_cycle: 'Value must not contain a cycle.',
  json_finite: 'Number must be finite.',
  json_object_plain: 'Object must be a plain JSON object.',
  json_property_data: 'Property must be an own enumerable data property.',
  json_property_key: 'Property keys must be strings.',
  json_type: 'Value must be JSON-compatible.',
  unicode_scalar: 'String must contain paired UTF-16 surrogates.',
} as const;

type PlainJsonKeyword = keyof typeof diagnosticMessages;

interface FaultExpectation {
  readonly instancePath: string;
  readonly keyword: PlainJsonKeyword;
  readonly message?: string;
}

const expectedFault = ({
  instancePath,
  keyword,
  message = AGENT_FAULT_MESSAGES.definitionInvalid,
}: FaultExpectation): AgentFault => ({
  code: 'revo.agent.definition_invalid',
  message,
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
        message: diagnosticMessages[keyword],
      },
    ],
    truncated: false,
  },
});

const expectPlainJsonFault = (
  value: unknown,
  keyword: PlainJsonKeyword,
  instancePath = '/definitions/0/value',
): void => {
  try {
    inspectPlainJson(value, '/definitions/0');
  } catch (error: unknown) {
    if (!(error instanceof AgentManagerError)) throw error;
    expect(error.fault).toEqual(expectedFault({ instancePath, keyword }));
    return;
  }

  throw new Error('Expected inspectPlainJson to reject the value');
};

test('accepts scalar-safe dense plain JSON without mutation', () => {
  const value = Object.freeze({ emoji: '\uD83D\uDE00', nested: Object.freeze([1, true, null]) });
  expect(inspectPlainJson(value, '/definitions/0')).toEqual({ depth: 3, nodes: 6 });
  expect(value.emoji).toBe('\uD83D\uDE00');
});

test('accepts two consecutive valid surrogate pairs', () => {
  expect(inspectPlainJson('\uD83D\uDE00\uD83D\uDE00', '/definitions/0')).toEqual({
    depth: 1,
    nodes: 1,
  });
});

test('accepts null-prototype objects and preserves paired-surrogate keys', () => {
  const value = { ['\uD83D\uDE00']: true };
  Object.setPrototypeOf(value, null);
  expect(inspectPlainJson(value, '/definitions/0')).toEqual({ depth: 2, nodes: 2 });
  expect(Reflect.ownKeys(value)).toEqual(['\uD83D\uDE00']);
});

test.each([
  '\uD800',
  '\uDC00',
  '\uD800A',
  '\uD83D\uDE00\uDC00',
  '\uD83D\uDE00\uD800',
  '\uD800\uD800',
])('rejects unpaired surrogate value %j', (bad) => {
  expect(() => inspectPlainJson({ nested: bad }, '/definitions/0')).toThrowError(AgentManagerError);
  try {
    inspectPlainJson({ nested: bad }, '/definitions/0');
  } catch (error: unknown) {
    if (!(error instanceof AgentManagerError)) throw error;
    expect(error.fault).toEqual(
      expectedFault({
        instancePath: '/definitions/0/nested',
        keyword: 'unicode_scalar',
        message: AGENT_FAULT_MESSAGES.invalidUnicode,
      }),
    );
  }
});

test('reports a malformed key at its parent without echoing it', () => {
  const badKey = '\uD800';
  const value = Object.defineProperty({}, badKey, { value: true, enumerable: true });

  try {
    inspectPlainJson(value, '/definitions/0/parameters/defaults');
  } catch (error: unknown) {
    if (!(error instanceof AgentManagerError)) throw error;
    expect(error.fault).toEqual(
      expectedFault({
        instancePath: '/definitions/0/parameters/defaults',
        keyword: 'unicode_scalar',
        message: AGENT_FAULT_MESSAGES.invalidUnicode,
      }),
    );
    expect(JSON.stringify(error.fault)).not.toContain(badKey);
    return;
  }

  throw new Error('Expected inspectPlainJson to reject the malformed key');
});

test.each([
  ['NaN', { value: Number.NaN }, 'json_finite'],
  ['positive infinity', { value: Number.POSITIVE_INFINITY }, 'json_finite'],
  ['negative infinity', { value: Number.NEGATIVE_INFINITY }, 'json_finite'],
  ['undefined', { value: undefined }, 'json_type'],
  ['function', { value: () => undefined }, 'json_type'],
  ['symbol', { value: Symbol('x') }, 'json_type'],
  ['bigint', { value: 1n }, 'json_type'],
  ['sparse array', { value: Array(1) }, 'json_array_dense'],
  ['date', { value: new Date(0) }, 'json_object_plain'],
  ['map', { value: new Map() }, 'json_object_plain'],
  ['set', { value: new Set() }, 'json_object_plain'],
  ['buffer', { value: Buffer.from('x') }, 'json_object_plain'],
  ['typed array', { value: new Uint8Array([1]) }, 'json_object_plain'],
] as const)('%s is rejected without invoking user code', (_name, value, keyword) => {
  expectPlainJsonFault(value, keyword);
});

test('rejects a self-cycle at its exact path', () => {
  const value: { self?: unknown } = {};
  value.self = value;
  expectPlainJsonFault(value, 'json_cycle', '/definitions/0/self');
});

test('rejects an enumerable accessor without invoking its getter', () => {
  let calls = 0;
  const value = Object.defineProperty({}, 'value', {
    enumerable: true,
    get: () => {
      calls += 1;
      return true;
    },
  });

  expectPlainJsonFault(value, 'json_property_data');
  expect(calls).toBe(0);
});

test('rejects an own toJSON function without invoking it', () => {
  let calls = 0;
  const value = {
    toJSON: () => {
      calls += 1;
      return {};
    },
  };

  expectPlainJsonFault(value, 'json_type', '/definitions/0/toJSON');
  expect(calls).toBe(0);
});

test('rejects a symbol key at its parent path', () => {
  const value = Object.defineProperty({}, Symbol('secret'), { value: true, enumerable: true });
  expectPlainJsonFault(value, 'json_property_key', '/definitions/0');
});

test('rejects a non-enumerable custom object key', () => {
  const value = Object.defineProperty({}, 'value', { value: true });
  expectPlainJsonFault(value, 'json_property_data');
});

test('rejects a class instance', () => {
  class JsonLike {
    readonly value = true;
  }

  expectPlainJsonFault(new JsonLike(), 'json_object_plain', '/definitions/0');
});

test('rejects an array with an own extra property', () => {
  const value = Object.defineProperty([true], 'extra', { value: false, enumerable: true });
  expectPlainJsonFault(value, 'json_array_dense', '/definitions/0');
});

test('rejects an object whose direct prototype is neither Object.prototype nor null', () => {
  const value = { value: true };
  Object.setPrototypeOf(value, {});
  expectPlainJsonFault(value, 'json_object_plain', '/definitions/0');
});

test('rejects an object Proxy without invoking reflection traps', () => {
  let calls = 0;
  const target = { value: true };
  const value = new Proxy(target, {
    getPrototypeOf: () => {
      calls += 1;
      return Object.prototype;
    },
    ownKeys: () => {
      calls += 1;
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor: (_target, key) => {
      calls += 1;
      return Object.getOwnPropertyDescriptor(target, key);
    },
  });

  expectPlainJsonFault(value, 'json_object_plain', '/definitions/0');
  expect(calls).toBe(0);
});

test('rejects an array Proxy without invoking reflection traps', () => {
  let calls = 0;
  const target = [true];
  const value = new Proxy(target, {
    getPrototypeOf: () => {
      calls += 1;
      return null;
    },
    ownKeys: () => {
      calls += 1;
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor: (_target, key) => {
      calls += 1;
      return Object.getOwnPropertyDescriptor(target, key);
    },
  });

  expectPlainJsonFault(value, 'json_object_plain', '/definitions/0');
  expect(calls).toBe(0);
});

test('rejects a revoked Proxy with a complete package fault', () => {
  const revocable = Proxy.revocable({}, {});
  revocable.revoke();
  expectPlainJsonFault(revocable.proxy, 'json_object_plain', '/definitions/0');
});

test('escapes JSON Pointer tokens in value paths', () => {
  expectPlainJsonFault({ '~key/': Number.NaN }, 'json_finite', '/definitions/0/~0key~1');
});

test('inspects a deeply nested acyclic value without consuming the JavaScript call stack', () => {
  let value: unknown = null;
  for (let depth = 0; depth < 20_000; depth += 1) value = { nested: value };

  expect(inspectPlainJson(value, '/definitions/0')).toEqual({ depth: 20_001, nodes: 20_001 });
});

test('exposes the exact frozen agent runtime limits', () => {
  expect(AGENT_RUNTIME_LIMITS).toEqual({
    definitionBytes: 1_048_576,
    schemaBytes: 1_048_576,
    definitions: 1_000,
    probeBatch: 1_000,
    schemaDepth: 64,
    schemaNodes: 8_192,
    resultNodes: 65_536,
    diagnosticCount: 16,
    diagnosticPathBytes: 1_024,
    diagnosticMessageBytes: 1_024,
    diagnosticKeywordBytes: 128,
    faultMessageBytes: 8_192,
    faultDetailsBytes: 65_536,
    probeStreamBytes: 65_536,
    versionProbePrefixBytes: 1_024,
    activeProbes: 8,
    argumentCount: 4_096,
    argumentBytes: 262_144,
    argvBytes: 1_048_576,
    agentIdentityBytes: 256,
    displayNameBytes: 256,
    descriptionBytes: 4_096,
    redactionValues: 1_000,
    redactionTotalBytes: 65_536,
  });
  expect(Object.isFrozen(AGENT_RUNTIME_LIMITS)).toBe(true);
});

test('exposes the exact frozen agent manager limit descriptors', () => {
  expect(AGENT_MANAGER_LIMITS).toEqual({
    wallClockTimeoutMs: { minimum: 1_000, default: 1_800_000, maximum: 1_800_000 },
    idleTimeoutMs: { minimum: 1_000, default: 300_000, maximum: 300_000 },
    maxEventBytes: { minimum: 1_024, default: 65_536, maximum: 65_536 },
    maxEventsFileBytes: { default: 16_777_216, maximum: 16_777_216 },
    maxStdoutBytes: { minimum: 65_536, default: 8_388_608, maximum: 8_388_608 },
    maxStderrBytes: { minimum: 65_536, default: 8_388_608, maximum: 8_388_608 },
    maxRawResponseBytes: { minimum: 65_536, default: 1_048_576, maximum: 1_048_576 },
    maxCompletedInvocations: { minimum: 1, default: 1_000, maximum: 1_000 },
    maxTerminalEventBytes: 2_097_152,
  });
  expect(Object.isFrozen(AGENT_MANAGER_LIMITS)).toBe(true);
});

test('exposes the exact frozen agent fault messages', () => {
  expect(AGENT_FAULT_MESSAGES).toEqual({
    definitionInvalid: 'Agent definition is invalid.',
    invalidUnicode: 'Agent definition contains invalid Unicode.',
    definitionDuplicate: 'Agent definition reference is duplicated.',
    strategyUnsupported: 'Agent strategy is unsupported.',
    limitInvalid: 'Agent manager limit is invalid.',
    agentUnknown: 'Agent reference is unknown.',
    probePlatformUnsupported: 'Agent platform is unsupported.',
    probeExecutableUnavailable: 'Agent executable is unavailable.',
    probeStartFailed: 'Agent version probe could not start.',
    probeTimeout: 'Agent version probe timed out.',
    probeOutputTooLarge: 'Agent version probe output exceeded its limit.',
    probeProcessFailed: 'Agent version probe exited unsuccessfully.',
    probeOutputInvalid: 'Agent version probe output is invalid.',
    probeVersionMismatch: 'Agent executable version does not satisfy its constraint.',
    internalConstruction: 'Agent manager construction failed unexpectedly.',
    internalProbe: 'Agent probe failed unexpectedly.',
  });
  expect(Object.isFrozen(AGENT_FAULT_MESSAGES)).toBe(true);
});
