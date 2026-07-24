import { expect, test } from 'vitest';

import { InvocationInputSnapshot } from '../../../../src/runtime/execution/index.js';

test('copies and freezes caller metadata without retaining nested containers', () => {
  const nested = { values: [1, 2] };
  Object.defineProperty(nested, '__proto__', {
    value: 'data',
    enumerable: true,
    configurable: true,
  });
  const metadata = { nested };
  const snapshot = InvocationInputSnapshot.create({
    invocationId: 'invocation-1',
    metadata,
    wallClockTimeoutMs: 1_000,
  });

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

  expect(InvocationInputSnapshot.create({ invocationId: '' })).toBeUndefined();
  expect(InvocationInputSnapshot.create({ invocationId: 'id', metadata: cyclic })).toBeUndefined();
  expect(
    InvocationInputSnapshot.create({ invocationId: 'id', metadata: accessor }),
  ).toBeUndefined();
  expect(InvocationInputSnapshot.create({ invocationId: 'id', metadata: [1] })).toBeUndefined();
  expect(
    InvocationInputSnapshot.create({ invocationId: 'id', wallClockTimeoutMs: 999 }),
  ).toBeUndefined();
});

test('uses iterative copy and freezing for a deep byte-valid metadata graph', () => {
  let metadata: unknown = 'end';
  for (let index = 0; index < 2_000; index += 1) metadata = { next: metadata };

  const snapshot = InvocationInputSnapshot.create({ invocationId: 'deep', metadata });
  expect(snapshot?.invocationId).toBe('deep');
  expect(snapshot?.wallClockTimeoutMs).toBe(1_800_000);
});

test('accepts transparent reflective Proxy views without retaining their source containers', () => {
  const nested = { value: 'before' };
  const metadata = new Proxy({ nested: new Proxy(nested, {}) }, {});
  const request = new Proxy({ invocationId: 'proxy', metadata }, {});
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

  expect(InvocationInputSnapshot.create({ invocationId: 'proxy-trap', metadata })).toBeUndefined();
});

test('allows acyclic aliases while copying each occurrence independently', () => {
  const shared = { value: [1] };
  const snapshot = InvocationInputSnapshot.create({
    invocationId: 'alias',
    metadata: { left: shared, right: shared },
  });
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
    InvocationInputSnapshot.create({
      invocationId: 'large-string',
      metadata: { value: 'x'.repeat(65_536) },
    }),
  ).toBeUndefined();
  expect(InvocationInputSnapshot.create({ invocationId: 'wide', metadata: wide })).toBeUndefined();
});

test('matches JSON short-control escape bytes at the metadata boundary', () => {
  const shortEscapes = ['\b', '\t', '\n', '\f', '\r'];
  for (const escape of shortEscapes) {
    const metadata = { value: escape.repeat(20_000) };
    expect(new TextEncoder().encode(JSON.stringify(metadata)).byteLength).toBe(40_012);
    expect(
      InvocationInputSnapshot.create({ invocationId: `short-${escape.charCodeAt(0)}`, metadata }),
    ).toBeDefined();
  }

  const atLimit = { value: '\n'.repeat(32_762) };
  const overLimit = { value: '\n'.repeat(32_763) };
  expect(new TextEncoder().encode(JSON.stringify(atLimit)).byteLength).toBe(65_536);
  expect(new TextEncoder().encode(JSON.stringify(overLimit)).byteLength).toBe(65_538);
  expect(
    InvocationInputSnapshot.create({ invocationId: 'at-limit', metadata: atLimit }),
  ).toBeDefined();
  expect(
    InvocationInputSnapshot.create({ invocationId: 'over-limit', metadata: overLimit }),
  ).toBeUndefined();
});

test('rejects an oversized invocation id before bounded validation and encoding', () => {
  expect(InvocationInputSnapshot.create({ invocationId: 'x'.repeat(257) })).toBeUndefined();
  expect(InvocationInputSnapshot.create({ invocationId: '😀'.repeat(129) })).toBeUndefined();
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
    InvocationInputSnapshot.create({ invocationId: 'sparse', metadata: { sparse } }),
  ).toBeUndefined();
  expect(
    InvocationInputSnapshot.create({ invocationId: 'infinite', metadata: { value: Infinity } }),
  ).toBeUndefined();
  expect(
    InvocationInputSnapshot.create({ invocationId: 'accessor', metadata: accessorView }),
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
    InvocationInputSnapshot.create({ invocationId: 'large-key', metadata: { [oversizedKey]: 1 } }),
  ).toBeUndefined();
  expect(
    InvocationInputSnapshot.create({ invocationId: 'deep-over-budget', metadata: deep }),
  ).toBeUndefined();
});

test('accounts astral Unicode scalars like JSON serialization', () => {
  const metadata = { key: '😀' };
  const serializedBytes = new TextEncoder().encode(JSON.stringify(metadata)).byteLength;
  expect(serializedBytes).toBe(14);
  expect(InvocationInputSnapshot.create({ invocationId: 'astral-😀', metadata })).toBeDefined();
});

test('rejects lone surrogates in invocation ids and metadata keys or values', () => {
  for (const surrogate of ['\ud800', '\udc00']) {
    expect(InvocationInputSnapshot.create({ invocationId: surrogate })).toBeUndefined();
    expect(
      InvocationInputSnapshot.create({
        invocationId: 'metadata-value',
        metadata: { value: surrogate },
      }),
    ).toBeUndefined();
    expect(
      InvocationInputSnapshot.create({
        invocationId: 'metadata-key',
        metadata: { [surrogate]: 'value' },
      }),
    ).toBeUndefined();
  }
});
