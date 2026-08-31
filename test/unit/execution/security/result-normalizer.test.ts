import { expect, test } from 'vitest';

import { normalizeResult } from '../../../../src/execution/result/normalizer.js';
import { createRawResponseCapture } from '../../../../src/execution/result/raw-response.js';

const encoder = new TextEncoder();

const normalize = (
  chunks: readonly Uint8Array[] | undefined,
  schema: Readonly<Record<string, unknown>> = { type: 'object' },
  maxBytes = 65_536,
) => {
  if (chunks === undefined) return normalizeResult({ evidence: undefined, schema });
  const capture = createRawResponseCapture({ maxBytes, previewBytes: 1_024, secrets: [] });
  for (const chunk of chunks) capture.record(chunk);
  return normalizeResult({ evidence: capture.take(), schema });
};

test.each([
  { chunks: undefined, code: 'revo.agent.result_missing', reason: 'missing_terminal' },
  { chunks: [new Uint8Array()], code: 'revo.agent.result_missing', reason: 'response_empty' },
  {
    chunks: [new Uint8Array([0xff])],
    code: 'revo.agent.result_invalid_json',
    reason: 'invalid_utf8',
  },
  {
    chunks: [encoder.encode('{not-json')],
    code: 'revo.agent.result_invalid_json',
    reason: 'invalid_json',
  },
  {
    chunks: [encoder.encode('[]')],
    code: 'revo.agent.result_not_object',
    reason: 'response_not_object',
  },
  {
    chunks: [encoder.encode('{"one":1}{"two":2}')],
    code: 'revo.agent.protocol_failed',
    reason: 'duplicate_terminal',
  },
])('maps $reason to its typed failure', ({ chunks, code, reason }) => {
  expect(normalize(chunks)).toMatchObject({ code, reason, status: 'failed' });
});

test('rejects a response that crosses the configured byte boundary', () => {
  const exact = encoder.encode(`{"value":"${'x'.repeat(65_524)}"}`);
  expect(exact.byteLength).toBe(65_536);
  expect(normalize([exact])).toMatchObject({ status: 'succeeded' });

  const oversized = encoder.encode(`{"value":"${'x'.repeat(65_525)}"}`);
  expect(normalize([oversized])).toMatchObject({
    code: 'revo.agent.result_too_large',
    reason: 'response_too_large',
    status: 'failed',
  });
});

test('validates one object with strict draft 2020-12 semantics without mutating it', () => {
  const schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    additionalProperties: false,
    properties: { count: { default: 3, type: 'number' } },
    required: ['count'],
    type: 'object',
  };
  const value = { count: '3' };
  const source = encoder.encode(JSON.stringify(value));

  expect(normalize([source], schema)).toMatchObject({
    code: 'revo.agent.result_schema_mismatch',
    status: 'failed',
  });
  expect(value).toEqual({ count: '3' });
  expect(schema.properties.count.default).toBe(3);
});

test('returns an owned deeply immutable result and bounded redacted evidence', () => {
  const capture = createRawResponseCapture({
    maxBytes: 65_536,
    previewBytes: 16,
    secrets: ['literal-secret'],
  });
  capture.record(encoder.encode('{"nested":{"token":"literal-secret"}}'));

  const normalized = normalizeResult({ evidence: capture.take(), schema: { type: 'object' } });

  expect(normalized).toMatchObject({
    rawResponse: {
      byteLength: 33,
      preview: '{"nested":{"toke',
      retainedByteLength: 33,
      truncated: false,
    },
    status: 'succeeded',
    value: { nested: { token: '[REDACTED]' } },
  });
  if (normalized.status !== 'succeeded') throw new Error('Expected a successful result.');
  expect(Object.isFrozen(normalized)).toBe(true);
  expect(Object.isFrozen(normalized.value)).toBe(true);
  expect(Object.isFrozen(normalized.value.nested)).toBe(true);
});

test('distinguishes a malformed trailing frame from a second terminal object', () => {
  expect(normalize([encoder.encode('{"one":1}not-json')])).toMatchObject({
    reason: 'invalid_json',
    status: 'failed',
  });
});

test('tracks escaped string content while detecting a duplicate terminal object', () => {
  expect(normalize([encoder.encode('{"quoted":"an \\"escaped\\" value"}{"two":2}')])).toMatchObject(
    {
      reason: 'duplicate_terminal',
      status: 'failed',
    },
  );
});

test('normalizes an invalid schema supplied below the public preflight seam', () => {
  expect(normalize([encoder.encode('{}')], { type: 'not-a-json-schema-type' })).toMatchObject({
    reason: 'schema_mismatch',
    status: 'failed',
  });
});

test('deep-freezes a deeply nested legal JSON result without recursive traversal', () => {
  const depth = 20_000;
  const source = encoder.encode(`${'{"value":'.repeat(depth)}null${'}'.repeat(depth)}`);

  const normalized = normalize([source], { type: 'object' }, 1_048_576);

  expect(normalized).toMatchObject({ status: 'succeeded' });
  if (normalized.status !== 'succeeded') throw new Error('Expected a successful deep result.');
  let current: unknown = normalized.value;
  for (let index = 0; index < depth; index += 1) {
    expect(Object.isFrozen(current)).toBe(true);
    if (typeof current !== 'object' || current === null || !('value' in current))
      throw new Error('Expected a nested value object.');
    current = current.value;
  }
  expect(current).toBeNull();
});
