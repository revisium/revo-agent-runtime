import { expect, test } from 'vitest';

import {
  instructionsMatchContinuation,
  readInstructionsContinuation,
} from '../../../../src/execution/instructions/continuation.js';

const digest = 'a'.repeat(64);
const stored = {
  instructionsDelivery: { mode: 'prompt_prefix' },
  instructionsDigest: digest,
  instructionsDispatched: true,
  sessionId: 'provider',
};

test('reads the stored instruction identity, channel mode, and dispatch flag', () => {
  expect(readInstructionsContinuation(stored)).toEqual({
    status: 'stored',
    value: { digest, dispatched: true, mode: 'prompt_prefix' },
  });
  expect(readInstructionsContinuation({ sessionId: 'provider' })).toEqual({ status: 'absent' });
});

test.each([
  ['a malformed digest', { ...stored, instructionsDigest: 'short' }],
  [
    'a missing digest',
    { instructionsDelivery: { mode: 'prompt_prefix' }, instructionsDispatched: false },
  ],
  ['an unknown mode', { ...stored, instructionsDelivery: { mode: 'system' } }],
  ['a non-object delivery', { ...stored, instructionsDelivery: 'prompt_prefix' }],
  ['a string dispatch flag', { ...stored, instructionsDispatched: 'true' }],
])('treats %s as an invalid continuation', (_label, data) => {
  expect(readInstructionsContinuation(data)).toEqual({ status: 'invalid' });
});

test('resume requires the same instructions, and legacy checkpoints cannot acquire them', () => {
  const continuation = readInstructionsContinuation(stored);

  expect(instructionsMatchContinuation(continuation, digest)).toBe(true);
  expect(instructionsMatchContinuation(continuation, 'b'.repeat(64))).toBe(false);
  expect(instructionsMatchContinuation(continuation, undefined)).toBe(false);
  expect(instructionsMatchContinuation({ status: 'absent' }, undefined)).toBe(true);
  expect(instructionsMatchContinuation({ status: 'absent' }, digest)).toBe(false);
  expect(instructionsMatchContinuation({ status: 'invalid' }, undefined)).toBe(false);
});
