import { expect, test } from 'vitest';

import {
  OUTPUT_TRUNCATION_MARKER,
  createBoundedOutput,
} from '../../../../src/execution/output/bounded-output.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

test('keeps output exactly at its byte boundary', () => {
  const output = createBoundedOutput({ maxBytes: 5, secrets: [] });

  output.write(encoder.encode('12345'));

  expect(decoder.decode(output.finalize().bytes)).toBe('12345');
  expect(output.finalize().truncated).toBe(false);
});

test('reserves the fixed marker inside the configured byte budget', () => {
  const maxBytes = OUTPUT_TRUNCATION_MARKER.byteLength + 4;
  const output = createBoundedOutput({ maxBytes, secrets: [] });

  output.write(encoder.encode('1234567890123456789012345'));
  const bounded = output.finalize();

  expect(bounded.bytes.byteLength).toBe(maxBytes);
  expect(decoder.decode(bounded.bytes)).toBe('1234\n[output truncated]\n');
  expect(bounded.truncated).toBe(true);
});

test('truncates only at a valid UTF-8 boundary', () => {
  const output = createBoundedOutput({
    maxBytes: OUTPUT_TRUNCATION_MARKER.byteLength + 2,
    secrets: [],
  });

  output.write(encoder.encode('é'.repeat(12)));

  expect(decoder.decode(output.finalize().bytes)).toBe('é\n[output truncated]\n');
});

test('backs over a split continuation byte before appending the marker', () => {
  const output = createBoundedOutput({
    maxBytes: OUTPUT_TRUNCATION_MARKER.byteLength + 3,
    secrets: [],
  });

  output.write(encoder.encode('é'.repeat(12)));

  expect(decoder.decode(output.finalize().bytes)).toBe('é\n[output truncated]\n');
});

test('redacts before applying the byte budget', () => {
  const output = createBoundedOutput({ maxBytes: 32, secrets: ['long-secret-value'] });

  output.write(encoder.encode('before long-secret-value after'));

  expect(decoder.decode(output.finalize().bytes)).toBe('before [REDACTED] after');
});
