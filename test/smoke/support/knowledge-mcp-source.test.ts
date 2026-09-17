import { spawn } from 'node:child_process';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import { knowledgeMcpSource } from './knowledge-mcp-source.js';

const send = (child: ReturnType<typeof spawn>, message: unknown): void => {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  child.stdin?.write(`Content-Length: ${body.length}\r\n\r\n`);
  child.stdin?.write(body);
};

const waitForFile = async (path: string, timeoutMs = 1_500): Promise<string> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- poll until the fixture writes the audit file
      return await readFile(path, 'utf8');
    } catch {
      if (Date.now() >= deadline) throw new Error(`missing ${path}`);
      // oxlint-disable-next-line no-await-in-loop -- bounded poll delay while waiting for audit
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
};

test('knowledge fixture source does not embed the instruction nonce', () => {
  expect(knowledgeMcpSource).not.toContain('nonce-');
  expect(knowledgeMcpSource.toLowerCase()).not.toContain('instruction nonce');
  expect(knowledgeMcpSource).toContain("description: 'Echo text for Revo live MCP evidence.'");
});

test('knowledge fixture writes a private tools/call audit for the instruction nonce', async () => {
  const root = await mkdtemp(join(tmpdir(), 'revo-mcp-audit-'));
  const script = join(root, 'knowledge-mcp.js');
  const audit = join(root, 'audit.ndjson');
  const nonce = 'Nq8vL2mR7wK4pX9cZ1aB';
  await writeFile(script, knowledgeMcpSource, { mode: 0o700 });
  const child = spawn(
    process.execPath,
    [script, `--audit=${audit}`, `--correlation=inv-context-1`],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  try {
    send(child, { id: 1, jsonrpc: '2.0', method: 'initialize', params: {} });
    send(child, {
      id: 2,
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { arguments: { text: nonce }, name: 'echo' },
    });
    const text = await waitForFile(audit);
    expect(text).toContain('"method":"tools/call"');
    expect(text).toContain('"name":"echo"');
    expect(text).toContain(nonce);
    expect(text).toContain('inv-context-1');
    expect((await stat(audit)).mode & 0o777).toBe(0o600);
  } finally {
    child.kill();
  }
});

test('knowledge fixture ignores MCP env audit bindings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'revo-mcp-env-audit-'));
  const script = join(root, 'knowledge-mcp.js');
  const audit = join(root, 'from-env.ndjson');
  await writeFile(script, knowledgeMcpSource, { mode: 0o700 });
  const child = spawn(process.execPath, [script], {
    env: { ...process.env, FIXTURE_MCP_AUDIT: audit, AUDIT_PATH: audit },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  try {
    send(child, {
      id: 1,
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { arguments: { text: 'Nq8vL2mR7wK4pX9cZ1aB' }, name: 'echo' },
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    await expect(stat(audit)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    child.kill();
  }
});
