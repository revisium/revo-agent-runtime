import { expect, test } from 'vitest';

import { snapshotInstructions } from '../../../../src/execution/instructions/text.js';

test('keeps non-empty instruction text and treats omitted or empty text as absent', () => {
  expect(snapshotInstructions('Read .revo/index.md first.')).toBe('Read .revo/index.md first.');
  expect(snapshotInstructions(undefined)).toBeUndefined();
  expect(snapshotInstructions('')).toBeUndefined();
});

test.each([
  ['legacy delivery object', { delivery: 'prompt-prefix', text: 'Read .revo/index.md' }],
  ['NUL character', 'read\0me'],
  ['oversized text', 'é'.repeat(131_001)],
  ['non-string value', 42],
  ['null value', null],
])('rejects %s', (_label, value) => {
  expect(() => snapshotInstructions(value)).toThrow(TypeError);
});

test('accepts text exactly at the byte limit', () => {
  expect(snapshotInstructions('x'.repeat(262_000))).toHaveLength(262_000);
});
