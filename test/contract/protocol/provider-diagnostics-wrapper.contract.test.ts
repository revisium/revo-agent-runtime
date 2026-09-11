import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

import { withTemporaryDirectory } from '../../support/assertions/temporary-directory.js';

const wrapper = fileURLToPath(
  new URL('../../../scripts/provider-diagnostics-wrapper.mjs', import.meta.url),
);

const runBridge = async (
  child: string,
  input: string,
  capture: string,
): Promise<{ stdout: Buffer; stderr: string; code: number | null }> => {
  const childProcess = spawn(
    process.execPath,
    [wrapper, process.execPath, child, '--capture', capture],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  childProcess.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
  childProcess.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
  childProcess.stdin.end(input);
  const code = await new Promise<number | null>((resolve, reject) => {
    childProcess.once('error', reject);
    childProcess.once('exit', (exitCode) => resolve(exitCode));
  });
  return { code, stderr: Buffer.concat(stderr).toString('utf8'), stdout: Buffer.concat(stdout) };
};

test('forwards protocol bytes while retaining bounded redacted evidence', async () => {
  await withTemporaryDirectory(async (directory) => {
    const child = join(directory, 'child.mjs');
    const capture = join(directory, 'capture.json');
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: { stopReason: 'end_turn', text: '🙂'.repeat(20_000) },
    });
    await writeFile(
      child,
      `process.stdin.resume(); process.stdin.on('end', () => { process.stderr.write('API_'); setTimeout(() => { process.stderr.write('KEY=private-secret\\n'); process.stdout.write(${JSON.stringify(payload)} + '\\n'); }, 1); });`,
    );

    const result = await runBridge(child, '{"jsonrpc":"2.0"}\n', capture);
    const artifact = JSON.parse(await readFile(capture, 'utf8')) as {
      outbound: unknown[];
      stderr: string[];
      truncation: { outbound: boolean; stderr: boolean; droppedObservations: number };
      child: { code: number | null };
      wrapper: { code: number | null };
    };

    expect(result.code).toBe(0);
    expect(result.stdout.toString('utf8')).toBe(`${payload}\n`);
    expect(result.stderr).not.toContain('private-secret');
    expect(JSON.stringify(artifact)).not.toContain('private-secret');
    expect(artifact.truncation.outbound).toBe(true);
    expect(artifact.truncation.stderr).toBe(false);
    expect(artifact.child).toEqual({ code: 0, signal: null });
    expect(artifact.wrapper).toEqual({ code: 0, signal: null });
  });
});

test('redacts nested credential-shaped ACP error fields', async () => {
  await withTemporaryDirectory(async (directory) => {
    const child = join(directory, 'child.mjs');
    const capture = join(directory, 'capture.json');
    await writeFile(
      child,
      `process.stdin.resume(); process.stdin.on('end', () => process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:1,error:{code:-32000,message:'provider failed',data:{token:'SYNTHETIC_PRIVATE_TOKEN',details:'useful diagnostic'}}})+'\\n'));`,
    );
    await runBridge(child, 'ping\n', capture);
    const artifact = await readFile(capture, 'utf8');
    expect(artifact).not.toContain('SYNTHETIC_PRIVATE_TOKEN');
    expect(artifact).toContain('useful diagnostic');
  });
});

test('records oversized valid frames as truncation instead of malformed evidence', async () => {
  await withTemporaryDirectory(async (directory) => {
    const child = join(directory, 'child.mjs');
    const capture = join(directory, 'capture.json');
    await writeFile(
      child,
      `process.stdin.resume(); process.stdin.on('end', () => process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:1,result:{text:'x'.repeat(40_000)}})+'\\n'));`,
    );
    await runBridge(child, 'ping\n', capture);
    const artifact = JSON.parse(await readFile(capture, 'utf8')) as {
      outbound: Array<{ kind?: string }>;
      truncation: { outbound: boolean };
    };
    expect(artifact.outbound).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'truncated' })]),
    );
    expect(artifact.outbound).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'malformed' })]),
    );
    expect(artifact.truncation.outbound).toBe(true);
  });
});
