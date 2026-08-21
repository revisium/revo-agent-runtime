import { EventEmitter } from 'node:events';

import { afterEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));

import { NodePosixProcessSpawnDispatch } from '../../../src/platform/process/node-posix-process-spawn-dispatch.js';
import {
  createProcessStartAttempt,
  PausedProcessIo,
  SpawnAcceptedProcess,
  type ProcessOutputSink,
  type ProcessSpawnRequest,
} from '../../../src/runtime/execution/index.js';

class FakeReadable extends EventEmitter {
  readonly onCalls: string[] = [];
  readonly pipeCalls: unknown[] = [];
  readonly resume = vi.fn();
  readonly iterator = vi.fn();

  override on(eventName: string | symbol, listener: (...arguments_: unknown[]) => void): this {
    this.onCalls.push(String(eventName));
    return super.on(eventName, listener);
  }

  pipe(destination: unknown): unknown {
    this.pipeCalls.push(destination);
    return destination;
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<Uint8Array> {
    this.iterator();
    return (async function* empty(): AsyncIterableIterator<Uint8Array> {})();
  }
}

class FakeChild extends EventEmitter {
  readonly stdout = new FakeReadable();
  readonly stderr = new FakeReadable();
  readonly stdin = new EventEmitter();
  pid = 42;
}

const outputSink = (): ProcessOutputSink =>
  Object.freeze({
    write: async (_chunk: Uint8Array): Promise<void> => undefined,
    end: async (): Promise<void> => undefined,
  });

const request = (): ProcessSpawnRequest =>
  Object.freeze({
    invocationId: 'spawn-dispatch-test',
    cwd: '/approved/workspace',
    executable: '/fixture/bin/agent',
    args: Object.freeze(['--json']),
    environment: Object.freeze({ REVO_TEST: '1' }),
    shell: false,
    stdin: 'pipe',
    stdout: outputSink(),
    stderr: outputSink(),
  });

afterEach(() => {
  mocks.spawn.mockReset();
});

test('accepted spawn settles with authentic process and paused I/O carriers', async () => {
  const child = new FakeChild();
  mocks.spawn.mockReturnValue(child);
  const attempt = createProcessStartAttempt({ invocationId: 'spawn-dispatch-test' });
  const spawnRequest = request();
  const dispatch = new NodePosixProcessSpawnDispatch();

  dispatch.beginStart(attempt, spawnRequest);
  child.emit('spawn');

  const result = await attempt.settlement;
  expect(result.status).toBe('spawn_accepted');
  if (result.status !== 'spawn_accepted') throw new Error('Expected accepted spawn.');
  expect(SpawnAcceptedProcess.isAuthentic(result.process)).toBe(true);
  expect(PausedProcessIo.isAuthentic(result.io)).toBe(true);
  expect(result.process.invocationId).toBe('spawn-dispatch-test');
  expect(result.process.spawnedAt).toEqual(expect.any(Number));
  expect(result.io.invocationId).toBe('spawn-dispatch-test');
  expect(dispatch.handle(attempt)).toMatchObject({
    child,
    stdout: spawnRequest.stdout,
    stderr: spawnRequest.stderr,
  });
});

test('spawn error before acceptance rejects as spawn_failed', async () => {
  const child = new FakeChild();
  mocks.spawn.mockReturnValue(child);
  const attempt = createProcessStartAttempt({ invocationId: 'spawn-dispatch-test' });
  const dispatch = new NodePosixProcessSpawnDispatch();

  dispatch.beginStart(attempt, request());
  child.emit('error', new Error('ENOENT'));

  await expect(attempt.settlement).resolves.toEqual({
    status: 'rejected',
    reason: 'spawn_failed',
  });
  await expect(attempt.quiescence).resolves.toEqual({
    status: 'quiescent',
    disposition: 'not_spawned',
  });
  expect(dispatch.handle(attempt)).toBeUndefined();
});

test('malformed output sinks reject before spawn dispatch', async () => {
  const attempt = createProcessStartAttempt({ invocationId: 'spawn-dispatch-test' });
  const dispatch = new NodePosixProcessSpawnDispatch();
  const malformedRequest: unknown = {
    ...request(),
    stdout: { write: async (): Promise<void> => undefined },
  };

  Reflect.apply(dispatch.beginStart.bind(dispatch), dispatch, [attempt, malformedRequest]);

  await expect(attempt.settlement).resolves.toEqual({
    status: 'rejected',
    reason: 'spawn_failed',
  });
  expect(mocks.spawn).not.toHaveBeenCalled();
});

test('non-string environment values reject before spawn dispatch', async () => {
  const environment: Record<string, string> = {};
  Object.defineProperty(environment, 'INVALID', { enumerable: true, value: 1 });
  const attempt = createProcessStartAttempt({ invocationId: 'spawn-dispatch-test' });

  new NodePosixProcessSpawnDispatch().beginStart(attempt, {
    ...request(),
    environment,
  });

  await expect(attempt.settlement).resolves.toEqual({
    status: 'rejected',
    reason: 'spawn_failed',
  });
  expect(mocks.spawn).not.toHaveBeenCalled();
});

test('accepted spawn leaves stdout and stderr unread and unpumped', async () => {
  const child = new FakeChild();
  mocks.spawn.mockReturnValue(child);
  const attempt = createProcessStartAttempt({ invocationId: 'spawn-dispatch-test' });

  new NodePosixProcessSpawnDispatch().beginStart(attempt, request());
  child.emit('spawn');
  await expect(attempt.settlement).resolves.toMatchObject({ status: 'spawn_accepted' });

  expect(child.stdout.onCalls).toEqual([]);
  expect(child.stderr.onCalls).toEqual([]);
  expect(child.stdout.pipeCalls).toEqual([]);
  expect(child.stderr.pipeCalls).toEqual([]);
  expect(child.stdout.resume).not.toHaveBeenCalled();
  expect(child.stderr.resume).not.toHaveBeenCalled();
  expect(child.stdout.iterator).not.toHaveBeenCalled();
  expect(child.stderr.iterator).not.toHaveBeenCalled();
});
