import { expect, test } from 'vitest';

import { BoundedRawResponseEvidence } from '../../../../src/runtime/execution/index.js';

const evidence = (bytes: readonly number[]) =>
  BoundedRawResponseEvidence.create({
    byteLength: bytes.length,
    bytes: Uint8Array.from(bytes),
    previewBytes: bytes.length,
  });

test('peeks a copy without consuming retained raw-response bytes', () => {
  const subject = evidence([1, 2, 3]);

  const peeked = BoundedRawResponseEvidence.peek(subject);
  if (peeked === undefined) throw new Error('Expected peeked bytes.');
  peeked.fill(9);

  expect(BoundedRawResponseEvidence.peek(subject)).toEqual(Uint8Array.from([1, 2, 3]));
  expect(BoundedRawResponseEvidence.take(subject)).toEqual(Uint8Array.from([1, 2, 3]));
});

test('peek after take and second take both report already consumed', () => {
  const subject = evidence([4, 5, 6]);

  expect(BoundedRawResponseEvidence.take(subject)).toEqual(Uint8Array.from([4, 5, 6]));
  expect(BoundedRawResponseEvidence.take(subject)).toBeUndefined();
  expect(BoundedRawResponseEvidence.peek(subject)).toBeUndefined();
});
