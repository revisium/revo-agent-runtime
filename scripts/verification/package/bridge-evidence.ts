import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const validateBridgeEvidence = async (root: string): Promise<void> => {
  const packageJson: unknown = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.ok(isRecord(packageJson) && isRecord(packageJson.dependencies));
  assert.equal(packageJson.dependencies['@agentclientprotocol/codex-acp'], '1.7.0');
  assert.equal(packageJson.dependencies['@agentclientprotocol/claude-agent-acp'], '0.70.0');
  assert.equal(packageJson.dependencies['@openai/codex'], undefined);
  assert.equal(packageJson.dependencies['@anthropic-ai/claude-agent-sdk'], undefined);

  const notice = await readFile(join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  const normalizedNotice = notice.replaceAll(/\s+/g, ' ');
  for (const evidence of [
    '`@agentclientprotocol/codex-acp` | `1.7.0`',
    '`@openai/codex` | `0.148.0`',
    '`@agentclientprotocol/claude-agent-acp` | `0.70.0`',
    '`@anthropic-ai/claude-agent-sdk` | `0.3.232`',
    'SEE LICENSE IN README.md',
    'unresolved human release/legal gate',
    'sha512-+nUhAJyunx8Zc7r3',
    'sha512-Psqj6fhV4pQ8IM48',
    'sha512-bh5kH9+BMrFaHGmL',
    'sha512-8od7hJk9fZnF1/oY',
  ]) {
    assert.ok(normalizedNotice.includes(evidence), `Missing bridge evidence: ${evidence}`);
  }
};
