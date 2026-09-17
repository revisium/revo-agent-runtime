import { readFile } from 'node:fs/promises';

import { expect, test } from 'vitest';

import { claudeProviderPolicy } from '../../../../src/providers/claude/definition.js';
import { claudeInstructionsDelivery } from '../../../../src/providers/claude/instructions.js';

const request = (definitionVersion: string) => ({
  definitionId: 'claude-acp',
  definitionVersion,
  environmentNames: [],
  instructions: 'Read .revo/index.md.',
  outputDirectory: '/output',
  reportedVersion: '2.1.263',
});
const host = { platform: 'linux' };

test('the definition version is the bundled bridge version, not the installed CLI version', async () => {
  const manifest: unknown = JSON.parse(
    await readFile(new URL('../../../../package.json', import.meta.url), 'utf8'),
  );
  const bridge =
    typeof manifest === 'object' && manifest !== null && 'devDependencies' in manifest
      ? (manifest.devDependencies as Record<string, string>)[
          '@agentclientprotocol/claude-agent-acp'
        ]
      : undefined;

  expect(claudeProviderPolicy.version).toBe(bridge);
});

test('appends instructions through the bridge session metadata object, never a replacing string', () => {
  const plan = claudeInstructionsDelivery(request(claudeProviderPolicy.version), host);

  expect(plan).toEqual({
    channel: 'acp:session/new._meta.systemPrompt.append',
    mode: 'native_append',
    sessionMeta: { systemPrompt: { append: 'Read .revo/index.md.' } },
  });
  expect(JSON.stringify(plan)).not.toContain('baseInstructions');
});

test('another bridge version keeps the prefix default', () => {
  expect(claudeInstructionsDelivery(request('0.69.0'), host)).toBeUndefined();
});
