import { afterEach, expect, test, vi } from 'vitest';

import {
  canonicalizeJsonBytes,
  createDefinitionIdentity,
} from '../../../../src/runtime/definition/index.js';
import { AGENT_FAULT_MESSAGES } from '../../../../src/runtime/policy/index.js';
import type { AgentFault } from '../../../../src/runtime/spec/index.js';

const canonicalizeModule = '../../../../src/runtime/definition/rfc8785/index.js';
const canonicalHex = '7b2261223a312c2262223a327d';
const expectedDigest = '43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777';

const expectedInternalConstructionFault: AgentFault = {
  code: 'revo.agent.internal',
  message: AGENT_FAULT_MESSAGES.internalConstruction,
  phase: 'construction',
  retryable: false,
};

interface FaultError extends Error {
  readonly fault: AgentFault;
}

const isFaultError = (error: unknown): error is FaultError =>
  error instanceof Error && error.name === 'AgentManagerError' && Object.hasOwn(error, 'fault');

const isDeeplyFrozen = (value: unknown): boolean => {
  if (value === null || typeof value !== 'object') return true;
  if (!Object.isFrozen(value)) return false;

  return Object.values(value).every(isDeeplyFrozen);
};

const expectInternalConstructionFault = (action: () => unknown): FaultError => {
  try {
    action();
  } catch (error: unknown) {
    if (!isFaultError(error)) throw error;

    expect(error.fault).toEqual(expectedInternalConstructionFault);
    return error;
  }

  throw new Error('Expected an internal construction fault');
};

afterEach(() => {
  vi.doUnmock(canonicalizeModule);
  vi.resetModules();
});

test('derives the independent JCS vector digest from canonical bytes', () => {
  const input = { b: 2, a: 1 };
  const identity = createDefinitionIdentity(input);

  expect(Buffer.from(canonicalizeJsonBytes(input)).toString('hex')).toBe(canonicalHex);
  expect(identity).toEqual({ digest: expectedDigest, snapshot: { a: 1, b: 2 } });
  expect(identity.digest).toMatch(/^[0-9a-f]{64}$/);
  expect(identity.digest).toHaveLength(64);
});

test('normalizes insertion order through the canonical byte sequence', () => {
  const ordered = createDefinitionIdentity({ a: 1, b: 2 });
  const reordered = createDefinitionIdentity({ b: 2, a: 1 });

  expect(ordered.digest).toBe(expectedDigest);
  expect(reordered.digest).toBe(expectedDigest);
  expect(ordered.snapshot).toEqual({ a: 1, b: 2 });
  expect(reordered.snapshot).toEqual({ a: 1, b: 2 });
});

test('keeps digest results isolated between distinct definitions', () => {
  const first = createDefinitionIdentity({ agent: 'first' });
  const changed = createDefinitionIdentity({ agent: 'changed' });
  const unrelated = createDefinitionIdentity({ agent: 'unrelated' });

  expect(first.digest).not.toBe(changed.digest);
  expect(first.digest).not.toBe(unrelated.digest);
  expect(changed.digest).not.toBe(unrelated.digest);
});

test('owns an immutable snapshot independently of later caller mutations', () => {
  const input = { nested: { enabled: true }, items: [{ value: 1 }] };
  const identity = createDefinitionIdentity(input);

  input.nested.enabled = false;
  input.items[0]!.value = 2;
  input.items.push({ value: 3 });

  expect(identity.snapshot).toEqual({ nested: { enabled: true }, items: [{ value: 1 }] });
  expect(Reflect.set(identity.snapshot, 'changed', true)).toBe(false);
});

test('recursively freezes the parsed snapshot and its outer identity', () => {
  const identity = createDefinitionIdentity({ nested: { array: [{ value: true }] } });

  expect(Object.isFrozen(identity)).toBe(true);
  expect(isDeeplyFrozen(identity.snapshot)).toBe(true);
});

test('keeps Unicode code-unit-distinct values as distinct identities', () => {
  const precomposed = createDefinitionIdentity({ value: '\u00e9' });
  const decomposed = createDefinitionIdentity({ value: 'e\u0301' });

  expect(precomposed.digest).not.toBe(decomposed.digest);
});

test('maps a canonicalization invariant failure to the internal construction fault', async () => {
  const sentinel = new Error('canonicalization sentinel');
  const canonicalize = vi.fn(() => {
    throw sentinel;
  });
  vi.doMock(canonicalizeModule, () => ({ canonicalizeJsonBytes: canonicalize }));

  const { createDefinitionIdentity: createIdentity } =
    await import('../../../../src/runtime/definition/index.js');

  const error = expectInternalConstructionFault(() => createIdentity({ value: true }));
  expect(canonicalize).toHaveBeenCalledTimes(1);
  expect(error.message).not.toContain(sentinel.message);
  expect(JSON.stringify(error.fault)).not.toContain(sentinel.message);
  expect(error).not.toHaveProperty('cause');
});

test('maps a canonical parse invariant failure to the internal construction fault', async () => {
  const canonicalize = vi.fn(() => new Uint8Array([0xff]));
  vi.doMock(canonicalizeModule, () => ({ canonicalizeJsonBytes: canonicalize }));

  const { createDefinitionIdentity: createIdentity } =
    await import('../../../../src/runtime/definition/index.js');

  expectInternalConstructionFault(() => createIdentity({ value: true }));
  expect(canonicalize).toHaveBeenCalledTimes(1);
});

test('maps a parsed array root to the internal construction fault', async () => {
  const canonicalize = vi.fn(() => new TextEncoder().encode('[]'));
  vi.doMock(canonicalizeModule, () => ({ canonicalizeJsonBytes: canonicalize }));

  const { createDefinitionIdentity: createIdentity } =
    await import('../../../../src/runtime/definition/index.js');

  expectInternalConstructionFault(() => createIdentity({ value: true }));
  expect(canonicalize).toHaveBeenCalledTimes(1);
});
