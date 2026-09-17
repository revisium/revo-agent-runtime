import { expect, test } from 'vitest';

import { promptPrefixDelivery } from '../../../src/execution/instructions/delivery.js';
import { builtInInstructionsDelivery } from '../../../src/providers/index.js';

const request = (definitionId: string, definitionVersion: string) => ({
  definitionId,
  definitionVersion,
  environmentNames: [],
  instructions: 'Read .revo/index.md.',
  outputDirectory: '/output',
  reportedVersion: '1.18.23',
});

test('only Claude and OpenCode registrations own a native channel; every other provider prefixes', () => {
  const resolve = builtInInstructionsDelivery({ platform: 'linux' });

  expect(resolve(request('claude-acp', '0.70.0')).mode).toBe('native_append');
  expect(resolve(request('opencode-acp', '1.0.0')).mode).toBe('native_append');
  expect(resolve(request('codex-acp', '1.7.0'))).toBe(promptPrefixDelivery);
  expect(resolve(request('grok-acp', '1.0.0'))).toBe(promptPrefixDelivery);
  expect(resolve(request('unknown', '1'))).toBe(promptPrefixDelivery);
});

test('the host platform reaches provider eligibility', () => {
  expect(builtInInstructionsDelivery({ platform: 'win32' })(request('opencode-acp', '1.0.0'))).toBe(
    promptPrefixDelivery,
  );
});
