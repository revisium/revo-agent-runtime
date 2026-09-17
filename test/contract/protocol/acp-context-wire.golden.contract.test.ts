import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { expect, test } from 'vitest';

import { prefixInstructions } from '../../../src/protocol/acp/instructions.js';

const goldenUrl = new URL('../fixtures/acp-context-v1.golden.json', import.meta.url);
const digestUrl = new URL('../fixtures/acp-context-v1.golden.sha256', import.meta.url);

test('digests the ACP instruction and MCP wire golden and matches helper contracts', async () => {
  const [raw, digestFile] = await Promise.all([
    readFile(goldenUrl, 'utf8'),
    readFile(digestUrl, 'utf8'),
  ]);
  const golden: unknown = JSON.parse(raw);
  expect(golden).toMatchObject({
    claudeNativeAppendSessionNew: {
      _meta: { systemPrompt: { append: 'Answer in haiku. nonce-7c2e' } },
      cwd: '/workspace',
      mcpServers: [],
    },
    mcpStdioResolvedSessionNew: {
      cwd: '/workspace',
      mcpServers: [
        {
          args: ['mcp'],
          command: 'revo',
          env: [{ name: 'TOKEN', value: 'literal-secret' }],
          name: 'knowledge',
        },
      ],
    },
    omissionSessionNew: { cwd: '/workspace', mcpServers: [] },
    opencodeNativeConfigContent: {
      instructions: ['/output/revo-opencode-instructions.md'],
    },
    opencodeNativeSessionNew: { cwd: '/workspace', mcpServers: [] },
    schemaVersion: 'acp-context-wire/v1',
  });
  expect(typeof golden === 'object' && golden !== null && 'promptPrefix' in golden).toBe(true);
  const promptPrefix =
    typeof golden === 'object' &&
    golden !== null &&
    'promptPrefix' in golden &&
    typeof golden.promptPrefix === 'string'
      ? golden.promptPrefix
      : '';
  expect(promptPrefix).toBe(
    prefixInstructions(
      'Return the fake result.',
      'Read .revo/index.md before answering. nonce-4f1c',
    ),
  );
  expect(createHash('sha256').update(raw).digest('hex')).toBe(digestFile.trim());
});
