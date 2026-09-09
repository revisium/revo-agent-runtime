import type { ChildProcess } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { arch, release } from 'node:os';
import { resolve } from 'node:path';

import { execa } from 'execa';

const directory = resolve('.revisium-actions/native-diagnostics');

const captureProcessState = async (child: ChildProcess): Promise<void> => {
  try {
    await execa('ps', ['-axo', 'pid,ppid,pgid,stat,etime,%cpu,%mem,comm'], {
      stdout: ['inherit', { file: resolve(directory, 'processes.txt') }],
      timeout: 5_000,
    });
    if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return;
    // Signal only the test coordinator, whose Node report handler is enabled below.
    child.kill('SIGUSR2');
    if (process.platform === 'darwin') {
      await execa('sample', [String(child.pid), '3', '-file', resolve(directory, 'sample.txt')], {
        timeout: 10_000,
      });
    }
  } catch (error) {
    console.error('Could not capture all test process diagnostics:', error);
  }
};

await mkdir(directory, { recursive: true });
await writeFile(
  resolve(directory, 'host.json'),
  JSON.stringify({
    node: process.version,
    platform: process.platform,
    arch: arch(),
    os: release(),
  }),
);

const tests = execa(
  process.execPath,
  [
    '--report-on-signal',
    '--report-exclude-env',
    '--report-exclude-network',
    `--report-directory=${directory}`,
    'node_modules/vitest/vitest.mjs',
    'run',
    '--coverage',
    '--reporter=verbose',
    '--reporter=hanging-process',
    ...process.argv.slice(2),
  ],
  {
    forceKillAfterDelay: 2_000,
    killDescendants: true,
    reject: false,
    stderr: ['inherit', { file: resolve(directory, 'stderr.txt') }],
    stdout: ['inherit', { file: resolve(directory, 'stdout.txt') }],
    timeout: 240_000,
  },
);

let capture: Promise<void> | undefined;
const timer = setTimeout(() => {
  capture = captureProcessState(tests.nodeChildProcess);
}, 60_000);

try {
  const result = await tests;
  const outcome = {
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
  };
  await writeFile(resolve(directory, 'outcome.json'), JSON.stringify(outcome));
  console.log('Diagnostic test outcome:', outcome);
  process.exitCode = result.failed ? result.exitCode || 1 : 0;
} finally {
  clearTimeout(timer);
  await capture;
}
