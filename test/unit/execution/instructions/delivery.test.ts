import { expect, test } from 'vitest';

import {
  instructionsDeliveryOf,
  promptPrefixDelivery,
  resumedInstructionsDelivery,
  type InstructionsDeliveryPlan,
} from '../../../../src/execution/instructions/delivery.js';

const nativeMeta: InstructionsDeliveryPlan = {
  channel: 'acp:session/new._meta.systemPrompt.append',
  mode: 'native_append',
  sessionMeta: { systemPrompt: { append: 'Read .revo/index.md.' } },
};

test('the default plan prefixes the first prompt', () => {
  expect(promptPrefixDelivery).toEqual({
    channel: 'acp:session/prompt.prefix',
    mode: 'prompt_prefix',
  });
  expect(instructionsDeliveryOf(nativeMeta)).toEqual({
    channel: 'acp:session/new._meta.systemPrompt.append',
    mode: 'native_append',
  });
});

test.each([
  ['native stored and still eligible keeps native', 'native_append', nativeMeta, nativeMeta],
  [
    'native stored but now ineligible falls back to prefix',
    'native_append',
    promptPrefixDelivery,
    promptPrefixDelivery,
  ],
  [
    'prefix stored stays prefix even when native is eligible',
    'prompt_prefix',
    nativeMeta,
    promptPrefixDelivery,
  ],
  ['prefix stored stays prefix', 'prompt_prefix', promptPrefixDelivery, promptPrefixDelivery],
] as const)('resume mode rule: %s', (_label, storedMode, current, expected) => {
  expect(resumedInstructionsDelivery(current, storedMode)).toEqual(expected);
});
