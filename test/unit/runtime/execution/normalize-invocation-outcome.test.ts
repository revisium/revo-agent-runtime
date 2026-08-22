import { expect, test } from 'vitest';

import {
  BoundedRawResponseEvidence,
  normalizeInvocationOutcome,
  type ResultSchemaValidator,
} from '../../../../src/runtime/execution/index.js';
import type { JsonObject } from '../../../../src/runtime/spec/index.js';

const acceptObject: ResultSchemaValidator = Object.freeze({
  validate: () => undefined,
});

const cleanExit = Object.freeze({ exitCode: 0, signal: null });

const rawEvidence = (bytes: Uint8Array): BoundedRawResponseEvidence =>
  BoundedRawResponseEvidence.create({ byteLength: bytes.byteLength, bytes, previewBytes: 64 });

const completed = (input: {
  rawResponse?: BoundedRawResponseEvidence;
  parsedResponse?: JsonObject;
}) =>
  Object.freeze({
    status: 'completed' as const,
    spawnedAt: 123_456,
    exit: cleanExit,
    ...(input.rawResponse === undefined ? {} : { rawResponse: input.rawResponse }),
    ...(input.parsedResponse === undefined ? {} : { parsedResponse: input.parsedResponse }),
  });

test('normalizes a bounded JSON object into an immutable success outcome', () => {
  const rawResponse = rawEvidence(new TextEncoder().encode('{"status":"accepted"}'));

  const outcome = normalizeInvocationOutcome(completed({ rawResponse }), acceptObject);

  expect(outcome).toMatchObject({
    status: 'succeeded',
    value: { status: 'accepted' },
    evidence: { exit: cleanExit, rawResponse },
  });
  expect(Object.isFrozen(outcome)).toBe(true);
  if (outcome.status !== 'succeeded') throw new Error('Expected success outcome');
  expect(Object.isFrozen(outcome.value)).toBe(true);
});

test.each([
  [undefined, 'missing_terminal', 'revo.agent.result_missing'],
  [new Uint8Array(), 'response_empty', 'revo.agent.result_missing'],
  [new Uint8Array(1), 'response_too_large', 'revo.agent.result_too_large', 2],
  [new Uint8Array([0xc3, 0x28]), 'invalid_utf8', 'revo.agent.result_invalid_json'],
  [new TextEncoder().encode('{'), 'invalid_json', 'revo.agent.result_invalid_json'],
  [new TextEncoder().encode('null'), 'response_not_object', 'revo.agent.result_not_object'],
  [new TextEncoder().encode('true'), 'response_not_object', 'revo.agent.result_not_object'],
  [new TextEncoder().encode('1'), 'response_not_object', 'revo.agent.result_not_object'],
  [new TextEncoder().encode('"text"'), 'response_not_object', 'revo.agent.result_not_object'],
  [new TextEncoder().encode('[]'), 'response_not_object', 'revo.agent.result_not_object'],
] satisfies readonly (readonly [Uint8Array | undefined, string, string, number?])[])(
  'classifies raw response failures as %s',
  (bytes, reason, code, byteLength?: number) => {
    const rawResponse =
      bytes === undefined
        ? undefined
        : BoundedRawResponseEvidence.create({
            byteLength: byteLength ?? bytes.byteLength,
            bytes,
            previewBytes: 64,
          });

    const observation = rawResponse === undefined ? completed({}) : completed({ rawResponse });

    expect(normalizeInvocationOutcome(observation, acceptObject)).toMatchObject({
      status: 'failed',
      failure: { kind: 'parser', reason, code },
      evidence: { exit: cleanExit },
    });
  },
);

test('uses the validator only for a frozen top-level object and preserves bounded diagnostics', () => {
  const diagnostics = Object.freeze({ diagnostics: Object.freeze([]), truncated: false });
  const rawResponse = rawEvidence(new TextEncoder().encode('{"nested":{"ok":true}}'));
  let observed: unknown;
  const validator: ResultSchemaValidator = Object.freeze({
    validate: (value: JsonObject) => {
      observed = value;
      return diagnostics;
    },
  });
  const outcome = normalizeInvocationOutcome(completed({ rawResponse }), validator);

  expect(outcome).toMatchObject({
    status: 'failed',
    failure: { kind: 'result_schema', code: 'revo.agent.result_schema_mismatch', diagnostics },
    evidence: { exit: cleanExit, rawResponse, schemaDiagnostics: diagnostics },
  });
  if (typeof observed !== 'object' || observed === null || Array.isArray(observed))
    throw new Error('Expected a JSON object.');
  expect(Object.isFrozen(observed)).toBe(true);
  expect(Object.isFrozen(Object.getOwnPropertyDescriptor(observed, 'nested')?.value)).toBe(true);
});

test('does not retain mutable raw response bytes and maps validator throws without an error payload', () => {
  const response = new TextEncoder().encode('{"value":1}');
  const rawResponse = rawEvidence(response);
  const validator: ResultSchemaValidator = Object.freeze({
    validate: () => {
      throw new Error('secret validator detail');
    },
  });
  const outcome = normalizeInvocationOutcome(completed({ rawResponse }), validator);
  response.fill(0);

  expect(outcome).toMatchObject({
    status: 'failed',
    failure: { kind: 'result_schema', code: 'revo.agent.result_schema_mismatch' },
    evidence: { exit: cleanExit, rawResponse },
  });
  expect(JSON.stringify(outcome)).not.toContain('secret validator detail');
});

test('classifies truncated response evidence as oversized', () => {
  const rawResponse = BoundedRawResponseEvidence.create({
    byteLength: 1_048_577,
    bytes: new Uint8Array(1_048_576),
    previewBytes: 64,
  });

  const observation = rawResponse === undefined ? completed({}) : completed({ rawResponse });

  expect(normalizeInvocationOutcome(observation, acceptObject)).toMatchObject({
    status: 'failed',
    failure: {
      kind: 'parser',
      reason: 'response_too_large',
      code: 'revo.agent.result_too_large',
    },
    evidence: { exit: cleanExit, rawResponse },
  });
});

test('freezes a deep valid response iteratively without retaining its raw text', () => {
  const depth = 20_000;
  const response = new TextEncoder().encode(`${'{"next":'.repeat(depth)}{}${'}'.repeat(depth)}`);

  const outcome = normalizeInvocationOutcome(
    completed({ rawResponse: rawEvidence(response) }),
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
});

test('validates an already parsed protocol response without reparsing raw bytes', () => {
  let observed: unknown;
  const parsed = Object.freeze({ ok: true });
  const rawResponse = rawEvidence(new TextEncoder().encode('not-json'));
  const validator: ResultSchemaValidator = Object.freeze({
    validate: (value: JsonObject) => {
      observed = value;
      return undefined;
    },
  });

  const outcome = normalizeInvocationOutcome(
    completed({ parsedResponse: parsed, rawResponse }),
    validator,
  );

  expect(outcome).toMatchObject({
    status: 'succeeded',
    value: { ok: true },
    evidence: { rawResponse },
  });
  expect(observed).toBe(parsed);
});
