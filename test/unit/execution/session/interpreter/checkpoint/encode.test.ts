import { createHash } from 'node:crypto';

import { expect, test } from 'vitest';

import {
  digestSessionContinuation,
  encodeSessionContinuation,
} from '../../../../../../src/execution/session/interpreter/checkpoint/encode.js';

const encode = (
  data: unknown,
  overrides: { format?: unknown; maxBytes?: number; secrets?: readonly string[] } = {},
): string =>
  Reflect.apply(encodeSessionContinuation, undefined, [
    {
      continuation: { data, format: overrides.format ?? 'acp/v1' },
      maxBytes: overrides.maxBytes ?? 1_048_576,
      secrets: overrides.secrets ?? [],
      usageBaseline: { inputTokens: 1, scope: 'session_cumulative', totalTokens: 1 },
    },
  ]) as string;

const decode = (value: string): unknown => {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  return JSON.parse(Buffer.from(`${value}${padding}`, 'base64url').toString('utf8')) as unknown;
};

test('encodes a canonical continuation envelope without base64 padding', () => {
  const encoded = encode({ count: 2, flags: [true, false, null], nested: { id: 'provider' } });
  expect(encoded).not.toContain('=');
  expect(decode(encoded)).toEqual({
    provider: {
      data: { count: 2, flags: [true, false, null], nested: { id: 'provider' } },
      format: 'acp/v1',
    },
    schemaVersion: 'agent-session-continuation-envelope/v1',
    usageBaseline: { inputTokens: 1, scope: 'session_cumulative', totalTokens: 1 },
  });

  for (const suffix of ['', 'x', 'xx', 'xxx'])
    expect(encode({ suffix })).toEqual(expect.any(String));
});

test.each([
  ['non-object data', null, {}],
  ['array data', [], {}],
  ['undefined value', { value: undefined }, {}],
  ['bigint value', { value: 1n }, {}],
  ['function value', { value: () => undefined }, {}],
  ['non-finite number', { value: Number.NaN }, {}],
  ['positive infinity', { value: Number.POSITIVE_INFINITY }, {}],
  ['non-JSON object prototype', { value: new Date(0) }, {}],
  ['embedded secret', { value: 'prefix-known-secret-suffix' }, { secrets: ['known-secret'] }],
  ['forbidden key', { Authorization: 'value' }, {}],
  ['forbidden nested key', { nested: { process: 1 } }, {}],
  ['empty format', {}, { format: '' }],
  ['non-string format', {}, { format: 1 }],
  ['oversized format', {}, { format: 'x'.repeat(257) }],
  ['zero byte limit', {}, { maxBytes: 0 }],
  ['unsafe byte limit', {}, { maxBytes: Number.MAX_SAFE_INTEGER + 1 }],
  ['fractional byte limit', {}, { maxBytes: 1.5 }],
  ['small byte limit', { value: 'large' }, { maxBytes: 1 }],
] as const)('rejects %s', (_label, data, overrides) => {
  expect(() => encode(data, overrides)).toThrow(
    'Provider continuation cannot cross the checkpoint boundary.',
  );
});

test('rejects cyclic, too-deep, and too-wide continuation graphs', () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  expect(() => encode(cyclic)).toThrow(TypeError);

  let deep: Record<string, unknown> = {};
  const root = deep;
  for (let index = 0; index < 33; index += 1) {
    const next: Record<string, unknown> = {};
    deep.next = next;
    deep = next;
  }
  expect(() => encode(root)).toThrow(TypeError);

  expect(() => encode({ values: Array.from({ length: 4_097 }, () => ({})) })).toThrow(TypeError);
});

test('rejects exotic properties and prototypes before invoking accessors', () => {
  let getterCalled = false;
  const accessor = {};
  Object.defineProperty(accessor, 'value', {
    enumerable: true,
    get: () => {
      getterCalled = true;
      return 'unsafe';
    },
  });
  const hidden = {};
  Object.defineProperty(hidden, 'value', { enumerable: false, value: 'hidden' });
  const symbol = { [Symbol('hidden')]: 'value' };
  const phantom = new Proxy(
    {},
    {
      getOwnPropertyDescriptor: () => undefined,
      ownKeys: () => ['phantom'],
    },
  );
  const cloneRejectedProxy = new Proxy({ value: 'safe' }, {});
  const customArray: unknown[] = [];
  Object.setPrototypeOf(customArray, null);

  for (const value of [
    accessor,
    hidden,
    symbol,
    phantom,
    cloneRejectedProxy,
    { value: customArray },
  ])
    expect(() => encode(value)).toThrow(TypeError);
  expect(getterCalled).toBe(false);
});

test('accepts a plain JSON object with a null prototype', () => {
  const value = Object.assign(Object.create(null) as Record<string, unknown>, { value: 'safe' });
  expect(decode(encode(value))).toMatchObject({ provider: { data: { value: 'safe' } } });
});

test('ignores empty secret markers but rejects a matching non-empty marker', () => {
  expect(encode({ value: 'safe' }, { secrets: ['', 'other'] })).toEqual(expect.any(String));
  expect(() => encode({ value: 'safe' }, { secrets: ['', 'safe'] })).toThrow(TypeError);
});

test('digests canonical JSON and rejects values canonical JSON cannot represent', () => {
  const digest = {
    digest: (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex'),
  };
  expect(digestSessionContinuation({ b: 2, a: 1 }, digest)).toBe(
    createHash('sha256').update('{"a":1,"b":2}').digest('hex'),
  );
  expect(() => digestSessionContinuation(undefined, digest)).toThrow(TypeError);
});
