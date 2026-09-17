import childProcess from 'node:child_process';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import { withTemporaryDirectory } from '../../support/assertions/temporary-directory.js';
import { installOpenCodeSpawnPreflight } from './opencode-spawn-preflight.js';

// These CLI stubs use Unix shebang execution and /bin environments.
const unixTest = test.skipIf(process.platform === 'win32');

const positiveAuthList = [
  '┌  Credentials ~/.local/share/opencode/auth.json',
  '│',
  '●  xAI api',
  '│',
  '└  1 credentials',
].join('\n');

const headerOnlyAuthList = [
  '┌  Credentials ~/.local/share/opencode/auth.json',
  '│',
  '└  0 credentials',
].join('\n');

const writeFixture = async (directory: string, authList: string): Promise<string> => {
  const stub = join(directory, 'opencode');
  const report = join(directory, 'child-report.json');
  await writeFile(
    stub,
    `#!${process.execPath}
const { writeFileSync } = require('node:fs');
if (process.argv.includes('auth') && process.argv.includes('list')) {
  process.stdout.write(${JSON.stringify(authList)});
  process.exit(0);
}
if (process.argv.includes('acp')) {
  writeFileSync(process.env.REVO_OPENCODE_PROBE_REPORT, JSON.stringify({
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    env: {
      HOME: process.env.HOME ?? '',
      OPENCODE_CONFIG_CONTENT: process.env.OPENCODE_CONFIG_CONTENT ?? '',
      OPENCODE_PRINT_LOGS: process.env.OPENCODE_PRINT_LOGS ?? '',
      PATH: process.env.PATH ?? '',
      XAI_API_KEY: process.env.XAI_API_KEY ? 'present' : 'absent',
    },
  }));
  process.exit(0);
}
process.exit(1);
`,
    { mode: 0o700 },
  );
  await chmod(stub, 0o700);
  return report;
};

unixTest('positive xai preflight forwards the same ACP cwd, env, config, and command', async () => {
  await withTemporaryDirectory(async (directory) => {
    const report = await writeFixture(directory, positiveAuthList);
    const record = join(directory, 'record.ndjson');
    const restore = installOpenCodeSpawnPreflight({ recordPath: record });
    const configContent = '{"instructions":["/tmp/revo-opencode-instructions.md"]}';
    const env = {
      HOME: '/tmp/home',
      OPENCODE_CONFIG_CONTENT: configContent,
      OPENCODE_PRINT_LOGS: '1',
      PATH: '/bin',
      REVO_OPENCODE_PROBE_REPORT: report,
    };
    const args = ['acp'];
    try {
      await new Promise((resolve, reject) => {
        const child = childProcess.spawn(join(directory, 'opencode'), args, {
          cwd: directory,
          env,
          stdio: 'ignore',
        });
        child.on('error', reject);
        child.on('close', (code) =>
          code === 0 ? resolve(undefined) : reject(new Error(String(code))),
        );
      });
      const child = JSON.parse(await readFile(report, 'utf8')) as {
        argv: string[];
        cwd: string;
        env: Record<string, string>;
      };
      expect(child.cwd).toBe(directory);
      expect(child.argv).toEqual(args);
      expect(child.env.HOME).toBe('/tmp/home');
      expect(child.env.PATH).toBe('/bin');
      expect(child.env.OPENCODE_PRINT_LOGS).toBe('1');
      expect(child.env.OPENCODE_CONFIG_CONTENT).toBe(configContent);
      expect(child.env.XAI_API_KEY).toBe('absent');
      const records = (await readFile(record, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { ready?: boolean; stage?: string });
      expect(records.some((item) => item.stage === 'before-forward')).toBe(true);
      expect(records.some((item) => item.ready === true)).toBe(true);
    } finally {
      restore();
    }
  });
});

unixTest('header-only auth list blocks ACP spawn', async () => {
  await withTemporaryDirectory(async (directory) => {
    await writeFixture(directory, headerOnlyAuthList);
    const restore = installOpenCodeSpawnPreflight({ recordPath: join(directory, 'record.ndjson') });
    try {
      expect(() =>
        childProcess.spawn(join(directory, 'opencode'), ['acp'], {
          cwd: directory,
          env: { HOME: '/tmp/home', PATH: '/bin' },
        }),
      ).toThrow(/opencode exact-context auth preflight failed/);
    } finally {
      restore();
    }
  });
});
