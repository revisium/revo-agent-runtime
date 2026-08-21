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

const decode = (chunks: readonly Uint8Array[]): string =>
  new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));

const waitUntil = (predicate: () => boolean, attempts = 50): Promise<void> => {
  if (predicate()) return Promise.resolve();
  if (attempts < 1)
    return Promise.reject(new Error('Timed out waiting for integration observation.'));
  return delay(10).then(() => waitUntil(predicate, attempts - 1));
};

const collectingSink = () => {
  const chunks: Uint8Array[] = [];
  return Object.freeze({
    chunks,
    write: async (chunk: Uint8Array): Promise<void> => {
      chunks.push(new Uint8Array(chunk));
    },
    end: async (): Promise<void> => undefined,
  });
};

test.runIf(process.platform === 'linux')(
  'activates real paused child I/O with redacted stdout fan-out, stderr evidence, quiescence, and stdin',
  async () => {
    const attempt = createProcessStartAttempt({ invocationId: 'spawn-dispatch-activation' });
    const token = await import('../../../src/runtime/execution/index.js').then((module) =>
      module.getProcessStartInvocationToken(attempt),
    );
    if (token === undefined) throw new Error('Expected process start invocation token.');
    const { DuplexCoordinatorRegistration } =
      await import('../../../src/runtime/execution/index.js');
    const stdout = collectingSink();
    const stderr = collectingSink();
    const protocol = collectingSink();
    const dispatch = new NodePosixProcessSpawnDispatch();
    dispatch.beginStart(attempt, {
      invocationId: 'spawn-dispatch-activation',
      cwd: process.cwd(),
      executable: '/bin/sh',
      args: [
        '-c',
        "printf 'out-secret\\n'; printf 'err-secret\\n' >&2; IFS= read -r data; printf 'stdin:%s\\n' \"$data\"",
      ],
      environment: Object.freeze({}),
      shell: false,
      stdin: 'pipe',
      stdout,
      stderr,
    });

    const result = await attempt.settlement;
    expect(result.status).toBe('spawn_accepted');
    if (result.status !== 'spawn_accepted') throw new Error('Expected accepted spawn.');
    const handle = dispatch.handle(attempt);
    if (handle === undefined || handle.child.pid === undefined)
      throw new Error('Expected a real spawned child handle.');

    const inspection = await dispatch.inspectIdentity(result.process, Date.now() + 1_000);
    expect(inspection.status).toBe('identified');
    if (inspection.status !== 'identified') throw new Error('Expected process identity.');

    const activation = dispatch.activateIo(
      result.process,
      result.io,
      inspection.identity,
      DuplexCoordinatorRegistration.create({
        invocationId: attempt.invocationId,
        invocationToken: token,
      }),
      {
        secretValues: ['secret'],
        maxStdoutBytes: 10_000,
        maxStderrBytes: 10_000,
        protocolObserverSink: protocol,
      },
    );
    expect(activation.status).toBe('activated');
    if (activation.status !== 'activated') throw new Error('Expected activation.');

    await activation.process.stdin.write(new TextEncoder().encode('ping'));
    await activation.process.stdin.end();
    await expect(activation.process.completion).resolves.toEqual({ exitCode: 0, signal: null });
    await expect(attempt.quiescence).resolves.toEqual({
      status: 'quiescent',
      disposition: 'transferred_to_coordinator',
    });
    await waitUntil(() => decode(stdout.chunks) === 'out-[REDACTED]\nstdin:ping\n');
    expect(decode(stdout.chunks)).toBe('out-[REDACTED]\nstdin:ping\n');
    expect(decode(protocol.chunks)).toBe('out-[REDACTED]\nstdin:ping\n');
    expect(decode(stderr.chunks)).toBe('err-[REDACTED]\n');
  },
);
