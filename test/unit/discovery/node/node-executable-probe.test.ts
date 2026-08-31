import { Readable } from 'node:stream';

import { expect, test } from 'vitest';

import {
  collectBounded,
  createNodeExecutableProbe,
  nodeExecutableProbe,
  normalizeHostPlatform,
} from '../../../../src/platform/node/probe/executable-probe.js';
import { createProcessCleanup } from '../../../../src/platform/node/process/cleanup.js';
import {
  nonExecutableFile,
  systemExecutable,
} from '../../../support/fixtures/system-executable.js';

const versionProbe = (args: readonly string[], timeoutMs = 1_000) =>
  nodeExecutableProbe.startVersionProbe({
    args,
    environment: {},
    executable: process.execPath,
    shell: false,
    stderrLimitBytes: 65_536,
    stdoutLimitBytes: 65_536,
    timeoutMs,
  });

test('resolves only absolute launchable files and distinguishes missing from non-launchable', async () => {
  await expect(nodeExecutableProbe.resolveExecutable(process.execPath)).resolves.toEqual({
    executable: process.execPath,
    status: 'resolved',
  });
  await expect(
    nodeExecutableProbe.resolveExecutable('/missing/revo-agent-runtime-executable'),
  ).resolves.toEqual({ reason: 'not_found', status: 'unavailable' });
  await expect(nodeExecutableProbe.resolveExecutable(process.cwd())).resolves.toEqual({
    reason: 'not_launchable',
    status: 'unavailable',
  });
  await expect(nodeExecutableProbe.resolveExecutable('node')).resolves.toMatchObject({
    status: 'resolved',
  });
  await expect(
    nodeExecutableProbe.resolveExecutable('revo-command-that-does-not-exist'),
  ).resolves.toEqual({ reason: 'not_found', status: 'unavailable' });
  await expect(nodeExecutableProbe.resolveExecutable('')).resolves.toEqual({
    reason: 'not_found',
    status: 'unavailable',
  });
  await expect(nodeExecutableProbe.resolveExecutable('bad\0command')).resolves.toEqual({
    reason: 'not_found',
    status: 'unavailable',
  });
  const fixture = await systemExecutable();
  try {
    const notExecutable = await nonExecutableFile(fixture.directory);
    await expect(nodeExecutableProbe.resolveExecutable(notExecutable)).resolves.toEqual({
      reason: 'not_launchable',
      status: 'unavailable',
    });
  } finally {
    await fixture.dispose();
  }
});

test('runs directly with an empty environment and retains exact stdout and stderr', async () => {
  const running = await versionProbe([
    '-e',
    "process.stdout.write(String(Object.keys(process.env).length)); process.stderr.write('1.2.3\\n')",
  ]);

  await expect(running.completion).resolves.toEqual({
    exitCode: 0,
    overflow: 'none',
    signal: null,
    status: 'exited',
    stderr: new TextEncoder().encode('1.2.3\n'),
    stdout: new TextEncoder().encode('0'),
  });
});

test('bounds both probe streams without buffering discarded bytes', async () => {
  const running = await versionProbe([
    '-e',
    "process.stdout.write('x'.repeat(65537)); process.stderr.write('y'.repeat(65537))",
  ]);
  const result = await running.completion;

  expect(result).toMatchObject({ exitCode: 0, overflow: 'both', status: 'exited' });
  if (result.status !== 'exited') throw new Error('Expected exited probe.');
  expect(result.stdout).toHaveLength(65_536);
  expect(result.stderr).toHaveLength(65_536);
});

test.each([
  ['stdout', "process.stdout.write('x'.repeat(65537))", 'stdout'],
  ['stderr', "process.stderr.write('x'.repeat(65537))", 'stderr'],
] as const)('reports an independent %s overflow', async (_name, source, overflow) => {
  const running = await versionProbe(['-e', source]);
  await expect(running.completion).resolves.toMatchObject({ overflow, status: 'exited' });
});

test('reports authentic nonzero and signal exits', async () => {
  const nonzero = await versionProbe(['-e', 'process.exit(7)']);
  const signalled = await versionProbe(['-e', "process.kill(process.pid, 'SIGTERM')"]);

  await expect(nonzero.completion).resolves.toMatchObject({ exitCode: 7, signal: null });
  await expect(signalled.completion).resolves.toMatchObject({ exitCode: null, signal: 'SIGTERM' });
});

test('timeout termination resolves only after the probe leader is reaped', async () => {
  const running = await versionProbe(['-e', 'setInterval(() => undefined, 1000)'], 20);
  await running.timeout;

  await expect(running.terminateAndReap()).resolves.toBeUndefined();
  await expect(running.completion).resolves.toMatchObject({ signal: 'SIGTERM', status: 'exited' });
});

test('contains an unavailable probe executable as a spawn failure', async () => {
  const running = await nodeExecutableProbe.startVersionProbe({
    args: ['--version'],
    environment: {},
    executable: '/missing/revo-agent-runtime-executable',
    shell: false,
    stderrLimitBytes: 65_536,
    stdoutLimitBytes: 65_536,
    timeoutMs: 1_000,
  });

  await expect(running.completion).resolves.toEqual({ status: 'spawn_failed' });
  await expect(running.terminateAndReap()).resolves.toBeUndefined();
});

test('bounded collection handles an absent stream and decoded string chunks', async () => {
  const absent = collectBounded(null, 10);
  await absent.completion;
  expect(absent.bytes()).toEqual(new Uint8Array());

  const strings = Readable.from(['one', 'two']);
  strings.setEncoding('utf8');
  const collected = collectBounded(strings, 10);
  await collected.completion;
  expect(new TextDecoder().decode(collected.bytes())).toBe('onetwo');
});

test('normalizes supported and unsupported Node host platforms', () => {
  expect(nodeExecutableProbe.hostPlatform()).toBe(process.platform);
  expect(normalizeHostPlatform('linux')).toBe('linux');
  expect(normalizeHostPlatform('darwin')).toBe('darwin');
  expect(normalizeHostPlatform('win32')).toBe('win32');
  expect(normalizeHostPlatform('aix')).toBe('other');
});

test('fails closed when version-probe cleanup cannot be confirmed', async () => {
  const probe = createNodeExecutableProbe((processGroupId, completion) => {
    const cleanup = createProcessCleanup(processGroupId, completion);
    return async () => {
      await cleanup();
      return { status: 'uncertain' };
    };
  });
  expect(probe.hostPlatform()).toBe(process.platform);
  const running = await probe.startVersionProbe({
    args: ['-e', 'setInterval(() => undefined, 1000)'],
    environment: {},
    executable: process.execPath,
    shell: false,
    stderrLimitBytes: 65_536,
    stdoutLimitBytes: 65_536,
    timeoutMs: 20,
  });
  await running.timeout;
  await expect(running.terminateAndReap()).rejects.toThrow('cleanup is uncertain');
});
