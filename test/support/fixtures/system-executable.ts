import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type ExecutableBehavior =
  | 'antigravity-version'
  | 'auth-failure'
  | 'environment-sensitive-version'
  | 'gemini-acp'
  | 'goose-version'
  | 'hermes-version'
  | 'incompatible-version'
  | 'large-version'
  | 'opencode-acp'
  | 'version';

interface SystemExecutableFixture {
  readonly directory: string;
  readonly executable: string;
  readonly link: string;
  readonly relative: string;
  readonly dispose: () => Promise<void>;
}

const fakeBridge = fileURLToPath(new URL('../fake-acp/agent.ts', import.meta.url));
const tsxLoader = import.meta.resolve('tsx');

const systemAcpBody = (launchArgument: string): string => `
const { spawn } = require('node:child_process');
if (process.argv[2] === '--version') {
  console.log('1.0.0');
} else if (process.argv[2] === ${JSON.stringify(launchArgument)}) {
  const child = spawn(${JSON.stringify(process.execPath)}, ${JSON.stringify([
    '--import',
    tsxLoader,
    fakeBridge,
    '--mode',
    'ok-result',
  ])}, { stdio: 'inherit' });
  child.on('exit', (code) => { process.exitCode = code ?? 1; });
} else {
  process.exitCode = 2;
}`;

const executableBody = (behavior: ExecutableBehavior): string => {
  switch (behavior) {
    case 'antigravity-version':
      return "if (process.argv[2] === '--version') { console.log('ACP server ready'); console.log('Build label: agy_acp_server_20260818_01_RC01'); } else { process.exitCode = 2; }";
    case 'auth-failure':
      return "if (process.argv[2] === '--version') { console.log('@agentclientprotocol/codex-acp 1.0.0'); } else { console.error('Authorization: Bearer fixture-secret'); process.exitCode = 1; }";
    case 'environment-sensitive-version':
      return "process.exitCode = process.argv[2] === '--version' && Object.keys(process.env).length === 0 ? 0 : 2;";
    case 'gemini-acp':
      return systemAcpBody('--acp');
    case 'goose-version':
      return "if (process.argv[2] === '--version') { console.log(' 1.48.0'); } else { process.exitCode = 2; }";
    case 'hermes-version':
      return "if (process.argv[2] === 'acp' && process.argv[3] === '--version') { console.log('0.19.0'); } else { process.exitCode = 2; }";
    case 'incompatible-version':
      return 'process.exitCode = 2;';
    case 'large-version':
      return "process.stdout.write('x'.repeat(8192));";
    case 'opencode-acp':
      return systemAcpBody('acp');
    case 'version':
      return "process.exitCode = process.argv[2] === '--version' ? 0 : 2;";
    default: {
      const unsupported: never = behavior;
      throw new Error(`Unsupported executable behavior: ${String(unsupported)}`);
    }
  }
};

const sourceFor = (behavior: ExecutableBehavior): string =>
  `#!${process.execPath}\n${executableBody(behavior)}\n`;

export const systemExecutable = async (
  behavior: ExecutableBehavior = 'version',
): Promise<SystemExecutableFixture> => {
  const directory = await mkdtemp(join(tmpdir(), 'revo-system-executable-'));
  const executable = join(directory, 'selected-agent');
  const link = join(directory, 'selected-agent-link');
  await writeFile(executable, sourceFor(behavior), 'utf8');
  await chmod(executable, 0o755);
  await symlink(executable, link);
  return {
    directory,
    executable,
    link,
    relative: 'selected-agent',
    dispose: async () => rm(directory, { force: true, recursive: true }),
  };
};

export const nonExecutableFile = async (directory: string): Promise<string> => {
  const path = join(directory, 'not-executable');
  await mkdir(directory, { recursive: true });
  await writeFile(path, '#!/bin/false\n', 'utf8');
  await chmod(path, 0o644);
  return path;
};
