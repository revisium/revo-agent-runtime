import { expect, test } from 'vitest';

import {
  snapshotPlainJson,
  snapshotPlainJsonObject,
} from '../../../../src/execution/output/plain-json-snapshot.js';

test.each([null, true, false, 0, -0, 1.5, 'text', 'é界😀\b\t\n\f\r\u001f"\\'])(
  'owns JSON scalar %j',
  (value) => {
    expect(snapshotPlainJson(value, 128)).toEqual(value);
  },
);

test('owns and freezes arrays, objects, empty containers, and shared values', () => {
  const shared = { nested: true };
  const source: Record<string, unknown> = { values: [null, [], {}, shared, shared] };
  Object.setPrototypeOf(source, null);

  const snapshot = snapshotPlainJsonObject(source, 1_024);

  expect(snapshot).toEqual({ values: [null, [], {}, { nested: true }, { nested: true }] });
  expect(Object.isFrozen(snapshot)).toBe(true);
  expect(Object.isFrozen(snapshot.values)).toBe(true);
});

test.each([0, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid byte limit %j', (maximum) => {
  expect(() => snapshotPlainJson({}, maximum)).toThrow('Invalid plain JSON byte limit.');
});

test.each([
  undefined,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  1n,
  Symbol('value'),
  () => undefined,
  '\ud800',
])('rejects non-JSON scalar %#', (value) => {
  expect(() => snapshotPlainJson({ value }, 1_024)).toThrow();
});

test('accounts for escaped strings and object punctuation at the exact byte boundary', () => {
  const value = { 'quoted"key': 'line\nvalue' };
  const exact = new TextEncoder().encode(JSON.stringify(value)).byteLength;

  expect(snapshotPlainJson(value, exact)).toEqual(value);
  expect(() => snapshotPlainJson(value, exact - 1)).toThrow('exceeds its byte limit');
});

test('rejects invalid object properties and prototypes without evaluating accessors', () => {
  expect(() => snapshotPlainJson(new Date(), 1_024)).toThrow('Invalid plain JSON object.');
  expect(() => snapshotPlainJson({ ['\ud800']: true }, 1_024)).toThrow('Invalid plain JSON key.');
  expect(() => snapshotPlainJson({ [Symbol('key')]: true }, 1_024)).toThrow(
    'Invalid plain JSON object.',
  );
  const accessor = Object.defineProperty({}, 'value', { enumerable: true, get: () => true });
  expect(() => snapshotPlainJson(accessor, 1_024)).toThrow('Invalid plain JSON object.');
});

test('rejects sparse, extended, and accessor-bearing arrays', () => {
  const sparse = new Array(2);
  expect(() => snapshotPlainJson(sparse, 1_024)).toThrow('Invalid plain JSON array.');

  const extended = new Array(2);
  extended[0] = true;
  Object.defineProperty(extended, 'extra', { enumerable: true, value: false });
  expect(() => snapshotPlainJson(extended, 1_024)).toThrow('Invalid plain JSON array.');

  const accessor = [true];
  Object.defineProperty(accessor, '0', { enumerable: true, get: () => true });
  expect(() => snapshotPlainJson(accessor, 1_024)).toThrow('Invalid plain JSON array.');

  for (const length of ['invalid', 1.5, -1]) {
    const invalidLength = new Proxy([], {
      getOwnPropertyDescriptor: (target, key) =>
        key === 'length'
          ? { ...Reflect.getOwnPropertyDescriptor(target, key), value: length }
          : Reflect.getOwnPropertyDescriptor(target, key),
    });
    expect(() => snapshotPlainJson(invalidLength, 1_024)).toThrow('Invalid plain JSON array.');
  }
});

test('rejects cycles and the structural node limit', () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  expect(() => snapshotPlainJson(cyclic, 1_024)).toThrow('Invalid plain JSON value.');

  const wide = { values: Array.from({ length: 65_536 }, () => null) };
  expect(() => snapshotPlainJson(wide, 1_048_576)).toThrow('exceeds its structural limit');
});

test('requires an object from the object snapshot entry point', () => {
  expect(() => snapshotPlainJsonObject('scalar', 128)).toThrow('Plain JSON object required.');
});
