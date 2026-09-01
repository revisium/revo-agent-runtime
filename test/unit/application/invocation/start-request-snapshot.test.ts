import { expect, test } from 'vitest';

import { snapshotStartRequest } from '../../../../src/application/invocation/start-request-snapshot.js';

const request = () => ({
  agent: { id: 'codex', version: '1.0.0' },
  invocationId: 'bounded-request',
  metadata: { source: 'unit' },
  output: { directory: '/tmp/output' },
  parameters: { nested: { count: 1 } },
  permissions: { allow: true },
  prompt: 'Return one object.',
  result: { schema: { type: 'object' } },
  workspace: { directory: '/tmp/workspace' },
});

test('returns an owned deeply frozen plain-JSON start snapshot', () => {
  const source = request();
  source.invocationId = 'bounded-é界😀';
  const snapshot = snapshotStartRequest(source);
  source.parameters.nested.count = 2;

  expect(snapshot.parameters).toEqual({ nested: { count: 1 } });
  expect(snapshot.invocationId).toBe('bounded-é界😀');
  expect(Object.isFrozen(snapshot)).toBe(true);
  expect(Object.isFrozen(snapshot.parameters.nested)).toBe(true);
});

test('owns and freezes optional configuration selections independently from business inputs', () => {
  const selections = { fast: false, model: 'gpt-5.6-sol' };
  const snapshot = snapshotStartRequest({
    ...request(),
    configuration: { catalogRevision: 'revision', selections },
  });
  selections.model = 'mutated';

  expect(snapshot.configuration).toEqual({
    catalogRevision: 'revision',
    selections: { fast: false, model: 'gpt-5.6-sol' },
  });
  expect(Object.isFrozen(snapshot.configuration)).toBe(true);
  expect(Object.isFrozen(snapshot.configuration?.selections)).toBe(true);
});

test.each([
  ['invocation id', () => ({ ...request(), invocationId: 'é'.repeat(129) })],
  ['prompt', () => ({ ...request(), prompt: 'x'.repeat(4_194_305) })],
  ['workspace path', () => ({ ...request(), workspace: { directory: 'x'.repeat(16_385) } })],
  ['output path', () => ({ ...request(), output: { directory: 'x'.repeat(16_385) } })],
  ['metadata', () => ({ ...request(), metadata: { value: 'x'.repeat(65_536) } })],
  ['parameters', () => ({ ...request(), parameters: { value: 'x'.repeat(262_144) } })],
  ['permissions', () => ({ ...request(), permissions: { value: 'x'.repeat(262_144) } })],
  ['result schema', () => ({ ...request(), result: { schema: { value: 'x'.repeat(1_048_576) } } })],
  ['non-finite number', () => ({ ...request(), parameters: { value: Number.POSITIVE_INFINITY } })],
  ['non-plain value', () => ({ ...request(), parameters: { value: new Date() } })],
  ['configuration value', () => ({ ...request(), configuration: { selections: { model: 42 } } })],
  [
    'configuration key',
    () => ({ ...request(), configuration: { selections: {}, unexpected: true } }),
  ],
  [
    'configuration count',
    () => ({
      ...request(),
      configuration: {
        selections: Object.fromEntries(
          Array.from({ length: 129 }, (_, index) => [`option-${index}`, 'value']),
        ),
      },
    }),
  ],
  [
    'unexpected nested key',
    () => ({ ...request(), workspace: { directory: '/tmp', extra: true } }),
  ],
  ['missing required key', () => ({ ...request(), workspace: {} })],
  ['invalid Unicode scalar', () => ({ ...request(), invocationId: '\ud800' })],
  ['non-plain request', () => Object.assign(new Date(), request())],
])('rejects an out-of-contract %s', (_name, build) => {
  expect(() => snapshotStartRequest(build())).toThrow('Agent invocation request is invalid.');
});

test('rejects cyclic and accessor-bearing values without evaluating application code', () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  expect(() => snapshotStartRequest({ ...request(), parameters: cyclic })).toThrow(
    'Agent invocation request is invalid.',
  );

  let accessed = false;
  const parameters = Object.defineProperty({}, 'value', {
    enumerable: true,
    get: () => {
      accessed = true;
      return 'not read';
    },
  });
  expect(() => snapshotStartRequest({ ...request(), parameters })).toThrow(
    'Agent invocation request is invalid.',
  );
  expect(accessed).toBe(false);

  const topLevel = Object.defineProperty(request(), 'prompt', {
    enumerable: true,
    get: () => {
      accessed = true;
      return 'not read';
    },
  });
  expect(() => snapshotStartRequest(topLevel)).toThrow('Agent invocation request is invalid.');
  expect(accessed).toBe(false);

  expect(() => snapshotStartRequest({ ...request(), [Symbol('unexpected')]: true })).toThrow(
    'Agent invocation request is invalid.',
  );
});

test('snapshots deeply nested legal JSON without recursive traversal', () => {
  const depth = 20_000;
  let parameters: Record<string, unknown> = {};
  for (let index = 0; index < depth; index += 1) parameters = { value: parameters };

  const snapshot = snapshotStartRequest({ ...request(), parameters });

  let current: unknown = snapshot.parameters;
  for (let index = 0; index < depth; index += 1) {
    if (typeof current !== 'object' || current === null || !('value' in current))
      throw new Error('Expected a nested value object.');
    expect(Object.isFrozen(current)).toBe(true);
    current = current.value;
  }
});
