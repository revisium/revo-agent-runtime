import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test, vi } from 'vitest';

import { NodePosixBoundedCommandPort } from '../../../src/platform/process/index.js';

const request = (overrides: Partial<Parameters<NodePosixBoundedCommandPort['start']>[0]> = {}) => ({
  command: process.execPath,
  args: [
    '--input-type=module',
    '--eval',
    "process.stdout.write('out'); process.stderr.write('err');",
  ],
  environment: Object.freeze({}),
  cwd: process.cwd(),
  ...overrides,
});

describe('NodePosixBoundedCommandPort', () => {
  const port = new NodePosixBoundedCommandPort();

  test('resolves executable paths and reports unavailable commands', async () => {
    await expect(
      port.resolve({ command: process.execPath, args: [], environment: Object.freeze({}) }),
    ).resolves.toEqual({ status: 'resolved', executable: process.execPath });
    await expect(
      port.resolve({
        command: '/path/that/does/not/exist',
        args: [],
        environment: Object.freeze({}),
      }),
    ).resolves.toEqual({ status: 'unavailable', reason: 'not_launchable' });
    await expect(
      port.resolve({ command: '', args: [], environment: Object.freeze({}) }),
    ).resolves.toEqual({ status: 'unavailable', reason: 'not_found' });
    await expect(
      port.resolve({
        command: 'definitely-not-an-executable',
        args: [],
        environment: Object.freeze({ PATH: '' }),
      }),
    ).resolves.toEqual({ status: 'unavailable', reason: 'not_found' });
  });

  test('resolves relative PATH entries against the requested cwd', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'revo-bounded-command-'));
    const bin = join(cwd, 'bin');
    const executable = join(bin, 'fixture');
    try {
      await mkdir(bin);
      await writeFile(executable, '#!/bin/sh\nexit 0\n');
      await chmod(executable, 0o755);

      await expect(
        port.resolve({
          command: 'fixture',
          args: [],
          environment: Object.freeze({ PATH: 'bin' }),
          cwd,
        }),
      ).resolves.toEqual({ status: 'resolved', executable });
    } finally {
      await rm(cwd, { force: true, recursive: true });
    }
  });

  test('captures bounded stdout and stderr', async () => {
    const running = await port.start(request());

    const completion = await running.completion;
    expect(completion).toMatchObject({
      status: 'exited',
      exitCode: 0,
      signal: null,
      overflow: 'none',
    });
    if (completion.status !== 'exited') throw new Error('Expected an exited process.');
    expect([...completion.stdout]).toEqual([...new TextEncoder().encode('out')]);
    expect([...completion.stderr]).toEqual([...new TextEncoder().encode('err')]);
  });

  test('reports stdout and stderr overflow independently and together', async () => {
    const stdoutOverflow = await port.start(request({ maxStdoutBytes: 1, maxStderrBytes: 10 }));
    const stdoutResult = await stdoutOverflow.completion;
    expect(stdoutResult).toMatchObject({
      status: 'exited',
      overflow: 'stdout',
    });
    if (stdoutResult.status !== 'exited') throw new Error('Expected an exited process.');
    expect([...stdoutResult.stdout]).toEqual([...new TextEncoder().encode('o')]);
    expect([...stdoutResult.stderr]).toEqual([...new TextEncoder().encode('err')]);

    const bothOverflow = await port.start(request({ maxStdoutBytes: 1, maxStderrBytes: 1 }));
    const bothResult = await bothOverflow.completion;
    expect(bothResult).toMatchObject({
      status: 'exited',
      overflow: 'both',
    });
    if (bothResult.status !== 'exited') throw new Error('Expected an exited process.');
    expect([...bothResult.stdout]).toEqual([...new TextEncoder().encode('o')]);
    expect([...bothResult.stderr]).toEqual([...new TextEncoder().encode('e')]);
  });

  test('rejects invalid limits before spawning', async () => {
    await expect(port.start(request({ timeoutMs: 0 }))).rejects.toThrow(
      'Command limits must be positive safe integers.',
    );
    await expect(port.start(request({ maxStdoutBytes: Number.NaN }))).rejects.toThrow(
      'Command limits must be positive safe integers.',
    );
  });

  test('reports spawn failure without signaling a process group', async () => {
    const kill = vi.spyOn(process, 'kill');
    const failed = await port.start(
      request({ command: '/path/that/does/not/exist', timeoutMs: 10 }),
    );
    try {
      await expect(failed.completion).resolves.toEqual({ status: 'spawn_failed' });
      await expect(failed.terminateAndReap()).resolves.toBeUndefined();
      expect(kill).not.toHaveBeenCalled();
      await expect(
        Promise.race([failed.timeout.then(() => 'settled'), Promise.resolve('pending')]),
      ).resolves.toBe('pending');
    } finally {
      kill.mockRestore();
    }
  });

  test('terminates and reaps a running process', async () => {
    const kill = vi.spyOn(process, 'kill');
    const running = await port.start(
      request({
        args: ['--input-type=module', '--eval', 'setTimeout(() => {}, 5000);'],
      }),
    );

    try {
      const startedAt = Date.now();
      await expect(running.terminateAndReap()).resolves.toBeUndefined();
      expect(Date.now() - startedAt).toBeLessThan(1_000);
      await expect(running.completion).resolves.toMatchObject({
        status: 'exited',
        exitCode: null,
        signal: 'SIGTERM',
      });
      expect(kill.mock.calls.map(([, signal]) => signal).filter((signal) => signal !== 0)).toEqual([
        'SIGTERM',
      ]);
    } finally {
      kill.mockRestore();
    }
  });

  test('accepts process groups that disappear before either signal', async () => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('process group is gone'), { code: 'ESRCH' });
    });
    try {
      const running = await port.start(
        request({ args: ['--input-type=module', '--eval', 'setTimeout(() => {}, 20);'] }),
      );

      await expect(running.terminateAndReap()).resolves.toBeUndefined();
      await expect(running.completion).resolves.toMatchObject({ status: 'exited' });
      expect(kill.mock.calls.every(([, signal]) => signal === 0)).toBe(true);
    } finally {
      kill.mockRestore();
    }
  });

  test('resolves cleanup evidence when the initial signal fails unexpectedly', async () => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('permission denied'), { code: 'EPERM' });
    });
    try {
      const running = await port.start(
        request({ args: ['--input-type=module', '--eval', 'setTimeout(() => {}, 20);'] }),
      );

      await expect(running.terminateAndReap()).resolves.toMatchObject({
        cause: 'termination_rejected',
        termSent: false,
        killSent: false,
      });
      await expect(running.completion).resolves.toMatchObject({ status: 'exited' });
    } finally {
      kill.mockRestore();
    }
  });

  test('resolves cleanup evidence when escalation fails unexpectedly', async () => {
    const originalKill = process.kill.bind(process);
    const kill = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (signal === 'SIGTERM') return originalKill(pid, signal);
      throw Object.assign(new Error('escalation denied'), { code: 'EPERM' });
    });
    try {
      const running = await port.start(
        request({ args: ['--input-type=module', '--eval', 'setTimeout(() => {}, 20);'] }),
      );

      await expect(running.terminateAndReap()).resolves.toMatchObject({
        cause: 'post_kill_confirmation_rejected',
        termSent: true,
        killSent: false,
      });
      await expect(running.completion).resolves.toMatchObject({ status: 'exited' });
    } finally {
      kill.mockRestore();
    }
  });
});
