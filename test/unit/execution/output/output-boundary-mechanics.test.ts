import { expect, test } from 'vitest';

import { captureEnvironment } from '../../../../src/execution/invocation/environment.js';
import {
  OUTPUT_TRUNCATION_MARKER,
  createBoundedOutput,
} from '../../../../src/execution/output/bounded-output.js';
import { createRawResponseCapture } from '../../../../src/execution/result/raw-response.js';

const encoder = new TextEncoder();

test('rejects unusable output byte limits and a truncated output that cannot reserve its marker', () => {
  for (const maxBytes of [0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => createBoundedOutput({ maxBytes, secrets: [] })).toThrow(
      'Output byte limit must be a positive safe integer.',
    );
  }

  const output = createBoundedOutput({
    maxBytes: OUTPUT_TRUNCATION_MARKER.byteLength - 1,
    secrets: [],
  });
  output.write(encoder.encode('x'.repeat(OUTPUT_TRUNCATION_MARKER.byteLength + 1)));
  expect(() => output.finalize()).toThrow('cannot reserve the truncation marker');
});

test('ignores writes after bounded output finalization', () => {
  const output = createBoundedOutput({ maxBytes: 8, secrets: [] });
  output.write(encoder.encode('before'));
  const finalized = output.finalize();
  output.write(encoder.encode('after'));

  expect(output.finalize()).toBe(finalized);
  expect(new TextDecoder().decode(finalized.bytes)).toBe('before');
});

test('captures an immutable raw response once and returns owned byte copies', () => {
  const capture = createRawResponseCapture({ maxBytes: 4, previewBytes: 2, secrets: [] });
  capture.record(encoder.encode('abcdef'));
  const evidence = capture.take();
  capture.record(encoder.encode('ignored'));

  expect(capture.take()).toBe(evidence);
  expect(evidence.diagnostic).toEqual({
    byteLength: 6,
    preview: 'ab',
    retainedByteLength: 4,
    truncated: true,
  });
  const bytes = evidence.bytes();
  bytes.fill(0);
  expect(new TextDecoder().decode(evidence.bytes())).toBe('abcd');
});

test.each([null, [], {}, { inherit: [], secrets: {}, variables: { KEY: 1 } }])(
  'rejects a malformed child environment %#',
  (environment) => {
    expect(() => captureEnvironment(environment, {})).toThrow('Invalid child environment.');
  },
);

test('enforces child environment name, value, cardinality, and total byte bounds', () => {
  const invalid = [
    { inherit: [], secrets: {}, variables: { 'not-valid': 'value' } },
    { inherit: [], secrets: {}, variables: { [`A${'a'.repeat(128)}`]: 'value' } },
    { inherit: [], secrets: {}, variables: { KEY: 'x'.repeat(65_537) } },
    { inherit: [], secrets: { SECRET: '' }, variables: {} },
    {
      inherit: [],
      secrets: {},
      variables: Object.fromEntries(Array.from({ length: 129 }, (_, index) => [`K${index}`, 'v'])),
    },
    { inherit: ['KEY'], secrets: {}, variables: { KEY: 'duplicate' } },
    {
      inherit: [],
      secrets: {},
      variables: Object.fromEntries(
        Array.from({ length: 5 }, (_, index) => [`KEY_${index}`, 'x'.repeat(60_000)]),
      ),
    },
  ];

  for (const environment of invalid)
    expect(() => captureEnvironment(environment, { KEY: 'inherited' })).toThrow();
});

test('rejects missing and credential-like inherited variables', () => {
  expect(() =>
    captureEnvironment({ inherit: ['MISSING'], secrets: {}, variables: {} }, {}),
  ).toThrow('Invalid inherited environment variable.');
  expect(() =>
    captureEnvironment(
      { inherit: ['ACCESS_TOKEN'], secrets: {}, variables: {} },
      { ACCESS_TOKEN: 'secret' },
    ),
  ).toThrow('Invalid inherited environment variable.');
});

test('owns a valid explicit environment and registers only secret values', () => {
  const request = {
    inherit: ['LANG'],
    secrets: { CHILD_SECRET: 'hidden' },
    variables: { ORDINARY: 'visible' },
  };
  const captured = captureEnvironment(request, { LANG: 'C.UTF-8' });
  request.variables.ORDINARY = 'mutated';

  expect(captured).toEqual({
    secrets: ['hidden'],
    values: { CHILD_SECRET: 'hidden', LANG: 'C.UTF-8', ORDINARY: 'visible' },
  });
  expect(Object.isFrozen(captured.values)).toBe(true);
  expect(Object.isFrozen(captured.secrets)).toBe(true);
});
