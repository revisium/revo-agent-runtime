import { describe, expect, test, vi } from 'vitest';

import {
  decodeImmutableJson,
  decodeImmutableJsonObject,
  SessionJsonError,
} from '../../../../../../src/application/session/boundary/input/immutable-json.js';

const limits = { maxBytes: 128, maxDepth: 4, maxNodes: 8 } as const;

describe('immutable session JSON boundary', () => {
  test('copies and deeply freezes plain JSON without retaining caller ownership', () => {
    const input = { nested: { values: [1, 'two', true, null] } };
    const decoded = decodeImmutableJson(input, limits);

    input.nested.values[0] = 99;

    expect(decoded).toEqual({ nested: { values: [1, 'two', true, null] } });
    expect(Object.isFrozen(decoded)).toBe(true);
    if (typeof decoded !== 'object' || decoded === null) throw new TypeError('Object expected.');
    expect(Object.isFrozen(Reflect.get(decoded, 'nested'))).toBe(true);
  });

  test('does not invoke accessors', () => {
    const getter = vi.fn(() => 'secret');
    const input = Object.defineProperty({}, 'value', { enumerable: true, get: getter });

    expect(() => decodeImmutableJson(input, limits)).toThrow(SessionJsonError);
    expect(getter).not.toHaveBeenCalled();
  });

  test.each([
    new Proxy({}, {}),
    Object.create({ inherited: true }),
    Object.defineProperty({}, Symbol('hidden'), { enumerable: true, value: 1 }),
    Object.assign(new Array(1), { length: 1 }),
  ])('rejects unsafe container shapes', (input) => {
    expect(() => decodeImmutableJson(input, limits)).toThrow(SessionJsonError);
  });

  test('rejects cycles and every configured bound', () => {
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;

    expect(() => decodeImmutableJson(cycle, limits)).toThrow(SessionJsonError);
    expect(() => decodeImmutableJson({ a: { b: { c: { d: true } } } }, limits)).toThrow(
      SessionJsonError,
    );
    expect(() =>
      decodeImmutableJson({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 }, limits),
    ).toThrow(SessionJsonError);
    expect(() => decodeImmutableJson({ value: 'x'.repeat(128) }, limits)).toThrow(SessionJsonError);
  });

  test.each([undefined, 1n, Number.NaN, '\ud800'])('rejects non-JSON scalar %s', (input) => {
    expect(() => decodeImmutableJson(input, limits)).toThrow(SessionJsonError);
  });

  test('rejects invalid decoder limits and non-object object requests', () => {
    expect(() => decodeImmutableJson({}, { ...limits, maxBytes: 0 })).toThrow(SessionJsonError);
    expect(() => decodeImmutableJson({}, { ...limits, maxDepth: 0 })).toThrow(SessionJsonError);
    expect(() => decodeImmutableJson({}, { ...limits, maxNodes: 0 })).toThrow(SessionJsonError);
    expect(() => decodeImmutableJsonObject([], limits)).toThrow(SessionJsonError);
    expect(decodeImmutableJson({ toJSON: 'plain data' }, limits)).toEqual({
      toJSON: 'plain data',
    });
  });
});
