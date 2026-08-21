import { expect, test } from 'vitest';

import {
  normalizeInvocationOutcome,
  type ResultSchemaValidator,
} from '../../../../src/runtime/execution/index.js';
import type { JsonObject } from '../../../../src/runtime/spec/index.js';

const acceptObject: ResultSchemaValidator = Object.freeze({
  validate: () => undefined,
});

test('normalizes a bounded JSON object into an immutable success outcome', () => {
  const response = new TextEncoder().encode('{"status":"accepted"}');

  const outcome = normalizeInvocationOutcome(
    Object.freeze({ status: 'completed', rawResponse: response }),
    acceptObject,
  );

  expect(outcome).toEqual({ status: 'succeeded', value: { status: 'accepted' } });
  expect(Object.isFrozen(outcome)).toBe(true);
  if (outcome.status !== 'succeeded') throw new Error('Expected success outcome');
  expect(Object.isFrozen(outcome.value)).toBe(true);
});

test.each([
  [undefined, 'response_missing'],
  [new Uint8Array(), 'response_empty'],
  [new Uint8Array(1_048_577), 'response_too_large'],
  [new Uint8Array([0xc3, 0x28]), 'response_invalid_utf8'],
  [new TextEncoder().encode('{'), 'response_invalid_json'],
  [new TextEncoder().encode('null'), 'response_json_primitive'],
  [new TextEncoder().encode('true'), 'response_json_primitive'],
  [new TextEncoder().encode('1'), 'response_json_primitive'],
  [new TextEncoder().encode('"text"'), 'response_json_primitive'],
  [new TextEncoder().encode('[]'), 'response_json_array'],
] as const)('classifies raw response failures as %s', (rawResponse, reason) => {
  const observation =
    rawResponse === undefined
      ? Object.freeze({ status: 'completed' as const })
      : Object.freeze({ status: 'completed' as const, rawResponse });
  const byteLength = rawResponse?.byteLength ?? 0;
  expect(normalizeInvocationOutcome(observation, acceptObject)).toEqual({
    status: 'failed',
    reason,
    rawResponse: { byteLength, truncated: byteLength > 1_048_576 },
  });
});

test('uses the validator only for a frozen top-level object and preserves bounded diagnostics', () => {
  const diagnostics = Object.freeze({ diagnostics: Object.freeze([]), truncated: false });
  let observed: unknown;
  const validator: ResultSchemaValidator = Object.freeze({
    validate: (value: JsonObject) => {
      observed = value;
      return diagnostics;
    },
  });
  const outcome = normalizeInvocationOutcome(
    Object.freeze({
      status: 'completed',
      rawResponse: new TextEncoder().encode('{"nested":{"ok":true}}'),
    }),
    validator,
  );

  expect(outcome).toEqual({
    status: 'failed',
    reason: 'response_schema_mismatch',
    diagnostics,
    rawResponse: { byteLength: 22, truncated: false },
  });
  if (typeof observed !== 'object' || observed === null || Array.isArray(observed))
    throw new Error('Expected a JSON object.');
  expect(Object.isFrozen(observed)).toBe(true);
  expect(Object.isFrozen(Object.getOwnPropertyDescriptor(observed, 'nested')?.value)).toBe(true);
});

test('does not retain mutable raw response bytes and maps validator throws without an error payload', () => {
  const response = new TextEncoder().encode('{"value":1}');
  const validator: ResultSchemaValidator = Object.freeze({
    validate: () => {
      throw new Error('secret validator detail');
    },
  });
  const outcome = normalizeInvocationOutcome(
    Object.freeze({ status: 'completed', rawResponse: response }),
    validator,
  );
  response.fill(0);

  expect(outcome).toEqual({
    status: 'failed',
    reason: 'response_schema_validation_failed',
    rawResponse: { byteLength: 11, truncated: false },
  });
  expect(JSON.stringify(outcome)).not.toContain('secret validator detail');
});

test('admits an exact 1 MiB response for parsing rather than classifying it as oversized', () => {
  const exactLimit = new Uint8Array(1_048_576);

  expect(
    normalizeInvocationOutcome(
      Object.freeze({ status: 'completed', rawResponse: exactLimit }),
      acceptObject,
    ),
  ).toEqual({
    status: 'failed',
    reason: 'response_invalid_json',
    rawResponse: { byteLength: 1_048_576, truncated: false },
  });
});

test('freezes a deep valid response iteratively without retaining its raw text', () => {
  const depth = 20_000;
  const response = new TextEncoder().encode(`${'{"next":'.repeat(depth)}{}${'}'.repeat(depth)}`);

  const outcome = normalizeInvocationOutcome(
    Object.freeze({ status: 'completed', rawResponse: response }),
    acceptObject,
  );

  expect(response.byteLength).toBeLessThan(1_048_576);
  if (outcome.status !== 'succeeded') throw new Error('Expected a success outcome.');
  let current: unknown = outcome.value;
  for (let index = 0; index < depth; index += 1) {
    if (typeof current !== 'object' || current === null || Array.isArray(current))
      throw new Error('Expected a nested object.');
    expect(Object.isFrozen(current)).toBe(true);
    current = Object.getOwnPropertyDescriptor(current, 'next')?.value;
  }
  expect(Object.isFrozen(current)).toBe(true);
  expect(Object.hasOwn(outcome, 'rawResponse')).toBe(false);
});

test('validates an already parsed protocol response without reparsing raw bytes', () => {
  let observed: unknown;
  const parsed = Object.freeze({ ok: true });
  const validator: ResultSchemaValidator = Object.freeze({
    validate: (value: JsonObject) => {
      observed = value;
      return undefined;
    },
  });

  const outcome = normalizeInvocationOutcome(
    Object.freeze({
      status: 'completed' as const,
      parsedResponse: parsed,
      rawResponse: new TextEncoder().encode('not-json'),
    }),
    validator,
  );

  expect(outcome).toEqual({ status: 'succeeded', value: { ok: true } });
  expect(observed).toBe(parsed);
});
