import { expect, test } from 'vitest';

import { createNodeProcessSpawner } from '../../../../src/platform/node/process/spawner.js';

const nodeLaunch = (source: string) => ({
  args: ['-e', source],
  command: process.execPath,
  cwd: process.cwd(),
  environment: {},
});

test.skipIf(process.platform !== 'linux')(
  'retains the authentic natural exit through confirmed cleanup',
  async () => {
    const process = await createNodeProcessSpawner().start(
      nodeLaunch('process.exit(7)'),
      new AbortController().signal,
    );

    await expect(process.completion).resolves.toEqual({ exitCode: 7, signal: null });
    await expect(process.terminateAndReap()).resolves.toEqual({
      exit: { exitCode: 7, signal: null },
      status: 'confirmed',
    });
  },
);

test.skipIf(process.platform !== 'linux')(
  'retains a successful exit and delivers both child output channels before cleanup',
  async () => {
    const stdout: Uint8Array[] = [];
    const stderr: Uint8Array[] = [];
    const process = await createNodeProcessSpawner().start(
      {
        ...nodeLaunch(
          "process.stdout.write('answer'); process.stderr.write('warning'); setTimeout(() => process.exit(0), 100)",
        ),
        onStderr: (chunk: Uint8Array) => stderr.push(chunk),
        onStdout: (chunk: Uint8Array) => stdout.push(chunk),
      },
      new AbortController().signal,
    );

    await expect(process.completion).resolves.toEqual({ exitCode: 0, signal: null });
    await expect(process.terminateAndReap()).resolves.toEqual({
      exit: { exitCode: 0, signal: null },
      status: 'confirmed',
    });
    expect(Buffer.concat(stdout).toString('utf8')).toBe('answer');
    expect(Buffer.concat(stderr).toString('utf8')).toBe('warning');
  },
);

test.skipIf(process.platform !== 'linux')(
  'retains the authentic signal exit through forced cleanup',
  async () => {
    const process = await createNodeProcessSpawner().start(
      nodeLaunch('setInterval(() => undefined, 1000)'),
      new AbortController().signal,
    );

    await expect(process.terminateAndReap()).resolves.toEqual({
      exit: { exitCode: null, signal: 'SIGTERM' },
      status: 'confirmed',
    });
    await expect(process.completion).resolves.toEqual({ exitCode: null, signal: 'SIGTERM' });
  },
);
