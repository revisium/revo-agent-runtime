import { expect, test } from 'vitest';

import {
  BoundedRawResponseEvidence,
  createRawResponseCapture,
  createRedactionChannel,
} from '../../../../src/runtime/execution/index.js';

const encoder = new TextEncoder();
const bytes = (value: string): Uint8Array => encoder.encode(value);

test('captures redacted bytes through split secret carry and exposes a stable preview view', () => {
  const capture = createRawResponseCapture({
    channel: createRedactionChannel(['SECRET']),
    maxRawResponseBytes: 64,
    previewBytes: 64,
  });

  capture.record(bytes('SEC'));
  capture.record(bytes('RET-value'));
  const evidence = capture.take();

  expect(evidence.view).toEqual({
    byteLength: 16,
    retainedByteLength: 16,
    truncated: false,
    preview: '[REDACTED]-value',
  });
  expect(new TextDecoder().decode(BoundedRawResponseEvidence.take(evidence))).toBe(
    '[REDACTED]-value',
  );
  expect(BoundedRawResponseEvidence.take(evidence)).toBeUndefined();
});

test('bounds retained raw response bytes, decodes invalid UTF-8 lossily, and zero-fills on dispose', () => {
  const retained = new Uint8Array([0xff, 0xfe, 0x61, 0x62, 0x63, 0x64]);
  const capture = createRawResponseCapture({
    channel: createRedactionChannel([]),
    maxRawResponseBytes: 4,
    previewBytes: 4,
  });

  capture.record(retained);
  const evidence = capture.take();

  expect(evidence.view).toEqual({
    byteLength: 6,
    retainedByteLength: 4,
    truncated: true,
    preview: '\uFFFD\uFFFDab',
  });
  const first = BoundedRawResponseEvidence.take(evidence);
  expect(first).toEqual(new Uint8Array([0xff, 0xfe, 0x61, 0x62]));
  expect(BoundedRawResponseEvidence.take(evidence)).toBeUndefined();
});

test('truncates once across many small records while retaining true byte length', () => {
  const capture = createRawResponseCapture({
    channel: createRedactionChannel([]),
    maxRawResponseBytes: 4,
    previewBytes: 8,
  });

  for (const value of ['a', 'b', 'c', 'd', 'e', 'f']) capture.record(bytes(value));
  const evidence = capture.take();

  expect(evidence.view).toEqual({
    byteLength: 6,
    retainedByteLength: 4,
    truncated: true,
    preview: 'abcd',
  });
});

test('zero-byte capture produces empty evidence and take is one-use', () => {
  const capture = createRawResponseCapture({
    channel: createRedactionChannel([]),
    maxRawResponseBytes: 4,
    previewBytes: 8,
  });

  const evidence = capture.take();

  expect(evidence.view).toEqual({
    byteLength: 0,
    retainedByteLength: 0,
    truncated: false,
    preview: '',
  });
  expect(BoundedRawResponseEvidence.take(evidence)).toEqual(new Uint8Array());
  expect(BoundedRawResponseEvidence.take(evidence)).toBeUndefined();
});

test('dispose without take zero-fills retained bytes and is idempotent', () => {
  const retained = bytes('secret');
  const channel = createRedactionChannel([]);
  const capture = createRawResponseCapture({ channel, maxRawResponseBytes: 16, previewBytes: 16 });

  capture.record(retained);
  capture.dispose();
  capture.dispose();

  expect(retained).toEqual(bytes('secret'));
  expect(capture.take().view).toEqual({
    byteLength: 0,
    retainedByteLength: 0,
    truncated: false,
    preview: '',
  });
});
