import { expect, test } from 'vitest';

import {
  openCodeInstructionsDelivery,
  openCodeInstructionsFileName,
} from '../../../../src/providers/opencode/instructions.js';

const request = {
  definitionId: 'opencode-acp',
  definitionVersion: '1.0.0',
  environmentNames: ['PATH', 'OPENCODE_PRINT_LOGS'],
  instructions: 'Read .revo/index.md. nonce-9a',
  outputDirectory: '/tmp/revo/output-1',
  reportedVersion: '1.18.23',
};
const linux = { platform: 'linux' };

test('an eligible OpenCode launch gets a private instructions file bound through its config content', () => {
  const plan = openCodeInstructionsDelivery(request, linux);
  const path = `/tmp/revo/output-1/${openCodeInstructionsFileName}`;

  expect(plan).toMatchObject({
    channel: 'opencode:config.instructions-file',
    environment: { OPENCODE_CONFIG_CONTENT: JSON.stringify({ instructions: [path] }) },
    mode: 'native_append',
  });
  if (plan === undefined || !('artifact' in plan)) throw new Error('Expected a file plan.');
  expect(plan.artifact.path).toBe(path);
  expect(new TextDecoder().decode(plan.artifact.bytes)).toBe(request.instructions);
  expect(openCodeInstructionsFileName).toMatch(/^[^.*?[\]{}][^*?[\]{}]*$/);
});

test.each([
  ['an unverified reported version', { ...request, reportedVersion: '1.18.22' }, linux],
  ['a newer reported version', { ...request, reportedVersion: '1.19.0' }, linux],
  ['a local build label', { ...request, reportedVersion: 'local' }, linux],
  ['Windows', request, { platform: 'win32' }],
  [
    'a caller or definition binding of OPENCODE_CONFIG_CONTENT in any case',
    { ...request, environmentNames: ['opencode_config_content'] },
    linux,
  ],
  [
    'a brace in the output directory',
    { ...request, outputDirectory: '/tmp/{env:HOME}/out' },
    linux,
  ],
])('%s keeps the prefix default', (_label, candidate, host) => {
  expect(openCodeInstructionsDelivery(candidate, host)).toBeUndefined();
});
