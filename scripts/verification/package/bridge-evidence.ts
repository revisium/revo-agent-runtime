import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const validateBridgeEvidence = async (root: string): Promise<void> => {
  const manifest: unknown = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null;
  assert.ok(
    isRecord(manifest) && isRecord(manifest.dependencies) && isRecord(manifest.devDependencies),
  );
  for (const [name, version] of Object.entries({
    '@agentclientprotocol/codex-acp': '1.7.0',
    '@agentclientprotocol/claude-agent-acp': '0.70.0',
  })) {
    assert.equal(manifest.devDependencies[name], version);
    assert.equal(manifest.dependencies[name], undefined);
  }
  const lock = await readFile(join(root, 'pnpm-lock.yaml'), 'utf8');
  assert.doesNotMatch(lock, /^  ['"]?@openai\/codex[^:]*@/m);
  assert.doesNotMatch(
    lock,
    /^  ['"]?@anthropic-ai\/claude-agent-sdk-(?:linux|darwin|win32)[^:]*@/m,
  );
  const licenses = await readFile(join(root, 'adapters/NOTICE.txt'), 'utf8');
  assert.ok(licenses.includes('@agentclientprotocol/codex-acp@1.7.0'));
  assert.ok(licenses.includes('@agentclientprotocol/claude-agent-acp@0.70.0'));
  assert.ok(licenses.includes('@anthropic-ai/claude-agent-sdk@0.3.232'));
};
