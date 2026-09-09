import { Readable } from 'node:stream';

import { afterEach, expect, test, vi } from 'vitest';

import {
  collectBounded,
  createNodeExecutableProbe,
  nodeExecutableProbe,
  normalizeHostPlatform,
} from '../../../../src/platform/node/probe/executable-probe.js';
import { ProcessStartError } from '../../../../src/process/index.js';
import { nodeProcessLauncher } from '../../../../src/process/node.js';
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

const admittedProbe = async (cleanupUncertain = false) => {
  const admitted = Promise.withResolvers<void>();
  const probe = createNodeExecutableProbe({
    start: async (launch, signal) => {
      const process = await nodeProcessLauncher.start(launch, signal);
      admitted.resolve();
      return {
        ...process,
        terminateAndReap: async () => {
          const outcome = await process.terminateAndReap();
          return cleanupUncertain ? { status: 'uncertain' as const } : outcome;
        },
      };
    },
  });
  const running = await probe.startVersionProbe({
    args: ['-e', 'setInterval(() => undefined, 1000)'],
    environment: {},
    executable: process.execPath,
    shell: false,
    stderrLimitBytes: 65_536,
    stdoutLimitBytes: 65_536,
    timeoutMs: 20,
  });
  await admitted.promise;
  return running;
};

afterEach(() => vi.unstubAllEnvs());

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
    // Windows has no POSIX executable permission bit; the version probe establishes launchability.
    await expect(nodeExecutableProbe.resolveExecutable(notExecutable)).resolves.toEqual(
      process.platform === 'win32'
        ? { executable: notExecutable, status: 'resolved' }
        : { reason: 'not_launchable', status: 'unavailable' },
    );
  } finally {
    await fixture.dispose();
  }
});

test('does not inherit application variables and retains exact stdout and stderr', async () => {
  vi.stubEnv('REVO_PROBE_ENV_SENTINEL', 'must-not-be-inherited');
  const running = await versionProbe([
    '-e',
    "process.stdout.write(String(process.env.REVO_PROBE_ENV_SENTINEL)); process.stderr.write('1.2.3\\n')",
  ]);

  await expect(running.completion).resolves.toEqual({
    exitCode: 0,
    overflow: 'none',
    signal: null,
    status: 'exited',
    stderr: new TextEncoder().encode('1.2.3\n'),
    stdout: new TextEncoder().encode('undefined'),
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

test('reports the native exit status of a failed version command', async () => {
  const nonzero = await versionProbe(['-e', 'process.exit(7)']);

  await expect(nonzero.completion).resolves.toMatchObject({ exitCode: 7, signal: null });
});

test('timeout termination resolves only after the probe leader is reaped', async () => {
  const running = await admittedProbe();
  await running.timeout;

  await expect(running.terminateAndReap()).resolves.toBeUndefined();
  const result = await running.completion;
  expect(result.status).toBe('exited');
  if (result.status !== 'exited') throw new Error('Expected native process exit.');
  expect(result.exitCode !== null || result.signal !== null).toBe(true);
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
  const running = await admittedProbe(true);
  await running.timeout;
  await expect(running.terminateAndReap()).rejects.toThrow('cleanup is uncertain');
});

test('times out during launch and waits for cancelled admission to settle', async () => {
  const admission = Promise.withResolvers<void>();
  let launchSignal: AbortSignal | undefined;
  const probe = createNodeExecutableProbe({
    start: async (launch, signal) => {
      launchSignal = signal;
      await admission.promise;
      return nodeProcessLauncher.start(launch, signal);
    },
  });
  const running = await probe.startVersionProbe({
    args: ['--version'],
    environment: {},
    executable: process.execPath,
    shell: false,
    stderrLimitBytes: 65_536,
    stdoutLimitBytes: 65_536,
    timeoutMs: 10,
  });
  await running.timeout;
  const cleanup = running.terminateAndReap();
  expect(launchSignal?.aborted).toBe(true);
  admission.resolve();
  await cleanup;
  await expect(running.completion).resolves.toEqual({ status: 'spawn_failed' });
});

test('preserves uncertain cleanup when process admission fails', async () => {
  const probe = createNodeExecutableProbe({
    start: async () => {
      throw new ProcessStartError('uncertain');
    },
  });
  const running = await probe.startVersionProbe({
    args: ['--version'],
    environment: {},
    executable: process.execPath,
    shell: false,
    stderrLimitBytes: 65_536,
    stdoutLimitBytes: 65_536,
    timeoutMs: 1000,
  });
  await expect(running.completion).resolves.toEqual({ status: 'spawn_failed' });
  await expect(running.terminateAndReap()).rejects.toThrow('cleanup is uncertain');
});
