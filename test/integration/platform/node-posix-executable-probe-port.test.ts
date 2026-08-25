import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import { NodePosixExecutableProbePort } from '../../../src/platform/process/index.js';

const createFixtureBin = async (): Promise<{ root: string; bin: string }> => {
  const root = await mkdtemp(join(tmpdir(), 'revo-probe-port-'));
  const bin = join(root, 'bin');
  await mkdir(bin);
  await writeFile(
    join(bin, 'revo-probe-helper-7f3a9c'),
    '#!/bin/sh\nprintf "fixture-agent/1.2.3\\n"\n',
  );
  await writeFile(join(bin, 'fixture-agent'), '#!/bin/sh\nexec revo-probe-helper-7f3a9c "$@"\n');
  await writeFile(join(bin, 'slow-agent'), '#!/bin/sh\nexec /bin/sleep 5\n');
  await chmod(join(bin, 'revo-probe-helper-7f3a9c'), 0o755);
  await chmod(join(bin, 'fixture-agent'), 0o755);
  await chmod(join(bin, 'slow-agent'), 0o755);
  return { root, bin };
};

const request = (executable: string, timeoutMs = 1_000) => ({
  executable,
  args: [],
  shell: false as const,
  timeoutMs,
  stdoutLimitBytes: 65_536 as const,
  stderrLimitBytes: 65_536 as const,
});

test.runIf(process.platform === 'linux')(
  'resolves and probes a fixture through the injected PATH',
  async () => {
    const fixture = await createFixtureBin();
    try {
      const environment = Object.freeze({
        PATH: `${fixture.bin}:${process.env.PATH ?? ''}`,
        HOME: process.env.HOME ?? '',
      });
      const port = new NodePosixExecutableProbePort(environment);
      await expect(port.resolveExecutable({ command: 'fixture-agent' })).resolves.toEqual({
        status: 'resolved',
        executable: join(fixture.bin, 'fixture-agent'),
      });
      const running = await port.startVersionProbe(request('fixture-agent'));
      await expect(running.completion).resolves.toMatchObject({
        status: 'exited',
        exitCode: 0,
        stdout: new TextEncoder().encode('fixture-agent/1.2.3\n'),
      });
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  },
);

test.runIf(process.platform === 'linux')(
  'proves the injected PATH is required by the spawned probe environment',
  async () => {
    const fixture = await createFixtureBin();
    try {
      const withPath = new NodePosixExecutableProbePort(
        Object.freeze({ PATH: `${fixture.bin}:${process.env.PATH ?? ''}` }),
      );
      const withoutPath = new NodePosixExecutableProbePort(Object.freeze({}));
      const successful = await withPath.startVersionProbe(request('fixture-agent'));
      const failed = await withoutPath.startVersionProbe(request('fixture-agent'));
      await expect(successful.completion).resolves.toMatchObject({ exitCode: 0 });
      const failedObservation = await failed.completion;
      expect(failedObservation.status === 'spawn_failed' || failedObservation.exitCode !== 0).toBe(
        true,
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  },
);

test.runIf(process.platform === 'linux')(
  'exposes the delegated timeout and termination path',
  async () => {
    const fixture = await createFixtureBin();
    try {
      const port = new NodePosixExecutableProbePort(Object.freeze({ PATH: fixture.bin }));
      const running = await port.startVersionProbe(request('slow-agent', 50));
      await Promise.race([
        running.timeout,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('probe timeout did not fire')), 1_000),
        ),
      ]);
      await running.terminateAndReap();
      await expect(running.completion).resolves.toMatchObject({
        status: 'exited',
        signal: 'SIGTERM',
      });
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  },
);

test.runIf(process.platform === 'linux')('reports a bare-name resolution failure', async () => {
  const port = new NodePosixExecutableProbePort(Object.freeze({ PATH: '' }));
  await expect(
    port.resolveExecutable({ command: 'definitely-not-an-executable-xyz' }),
  ).resolves.toEqual({ status: 'unavailable', reason: 'not_found' });
});
