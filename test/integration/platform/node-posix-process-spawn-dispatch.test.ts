import { setTimeout as delay } from 'node:timers/promises';

import { expect, test } from 'vitest';

import { NodePosixProcessSpawnDispatch } from '../../../src/platform/process/node-posix-process-spawn-dispatch.js';
import { createProcessStartAttempt } from '../../../src/runtime/execution/index.js';

const ignoredOutput = () =>
  Object.freeze({
    write: async (_chunk: Uint8Array): Promise<void> => undefined,
    end: async (): Promise<void> => undefined,
  });

const expectProcessAlive = (pid: number): void => {
  process.kill(pid, 0);
};

test.runIf(process.platform === 'linux')(
  'spawns a real child and leaves stdout buffered until a later activation slice reads it',
  async () => {
    const attempt = createProcessStartAttempt({ invocationId: 'spawn-dispatch-integration' });
    const dispatch = new NodePosixProcessSpawnDispatch();
    dispatch.beginStart(attempt, {
      invocationId: 'spawn-dispatch-integration',
      cwd: process.cwd(),
      executable: process.execPath,
      args: [
        '--input-type=module',
        '--eval',
        "process.stdout.write('buffered-output'); setTimeout(() => {}, 5000);",
      ],
      environment: Object.freeze({}),
      shell: false,
      stdin: 'pipe',
      stdout: ignoredOutput(),
      stderr: ignoredOutput(),
    });

    const result = await attempt.settlement;
    expect(result.status).toBe('spawn_accepted');
    const handle = dispatch.handle(attempt);
    if (handle === undefined || handle.child.pid === undefined)
      throw new Error('Expected a real spawned child handle.');

    try {
      expectProcessAlive(handle.child.pid);
      await delay(50);
      expect(handle.child.stdout.readableLength).toBeGreaterThan(0);
      expect(handle.child.stdout.readableEnded).toBe(false);
    } finally {
      process.kill(-handle.child.pid, 'SIGKILL');
    }
  },
);

test.runIf(process.platform === 'linux')(
  'inspects a real accepted child identity through the dispatch registry',
  async () => {
    const attempt = createProcessStartAttempt({ invocationId: 'spawn-dispatch-identity' });
    const dispatch = new NodePosixProcessSpawnDispatch();
    dispatch.beginStart(attempt, {
      invocationId: 'spawn-dispatch-identity',
      cwd: process.cwd(),
      executable: process.execPath,
      args: ['--input-type=module', '--eval', 'setTimeout(() => {}, 5000);'],
      environment: Object.freeze({}),
      shell: false,
      stdin: 'pipe',
      stdout: ignoredOutput(),
      stderr: ignoredOutput(),
    });

    const result = await attempt.settlement;
    expect(result.status).toBe('spawn_accepted');
    if (result.status !== 'spawn_accepted') throw new Error('Expected accepted spawn.');
    const handle = dispatch.handle(attempt);
    if (handle === undefined || handle.child.pid === undefined)
      throw new Error('Expected a real spawned child handle.');

    try {
      const inspection = await dispatch.inspectIdentity(result.process, Date.now() + 1_000);
      expect(inspection.status).toBe('identified');
      if (inspection.status !== 'identified') throw new Error('Expected process identity.');
      expect(inspection.identity.pid).toBe(handle.child.pid);
      expect(inspection.identity.processGroupId).toBe(handle.child.pid);
      expect(inspection.identity.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/u);
    } finally {
      process.kill(-handle.child.pid, 'SIGKILL');
    }
  },
);
