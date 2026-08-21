import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

import { afterEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  canonicalize: vi.fn(),
  readFile: vi.fn(),
  readlink: vi.fn(),
  spawn: vi.fn(),
  stat: vi.fn(),
}));

vi.mock('canonicalize', () => ({ default: mocks.canonicalize }));
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: mocks.spawn };
});
vi.mock('node:fs/promises', () => ({
  readFile: mocks.readFile,
  readlink: mocks.readlink,
  stat: mocks.stat,
}));

import { NodePosixProcessSpawnDispatch } from '../../../src/platform/process/node-posix-process-spawn-dispatch.js';
import {
  createProcessStartAttempt,
  getProcessStartInvocationToken,
  PausedProcessIo,
  SpawnAcceptedProcess,
  settleProcessStart,
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
  pid: number | undefined = 42;
}

const outputSink = (): ProcessOutputSink =>
  Object.freeze({
    write: async (_chunk: Uint8Array): Promise<void> => undefined,
    end: async (): Promise<void> => undefined,
  });

const statLine = (
  processGroupId: string | undefined,
  creationIdentity: string | undefined,
): string => {
  const fields = Array.from({ length: 20 }, () => '1');
  if (processGroupId !== undefined) fields[2] = processGroupId;
  if (creationIdentity !== undefined) fields[19] = creationIdentity;

  return `1 (reference-child) ${fields.join(' ')}`;
};

const prepareInspection = (statValue = statLine('42', '123')): void => {
  mocks.readFile.mockImplementation(async (path: string) =>
    path.endsWith('/stat') ? statValue : 'boot-session\n',
  );
  mocks.readlink.mockResolvedValue('/fixture/bin/agent');
  mocks.stat.mockResolvedValue({ dev: 1n, ino: 2n });
  mocks.canonicalize.mockReturnValue('{"fixture":true}');
};

const acceptedProcess = async (
  dispatch = new NodePosixProcessSpawnDispatch(),
  child = new FakeChild(),
): Promise<{
  readonly attempt: ReturnType<typeof createProcessStartAttempt>;
  readonly child: FakeChild;
  readonly dispatch: NodePosixProcessSpawnDispatch;
  readonly process: SpawnAcceptedProcess;
}> => {
  mocks.spawn.mockReturnValue(child);
  const attempt = createProcessStartAttempt({ invocationId: 'spawn-dispatch-test' });
  dispatch.beginStart(attempt, request());
  child.emit('spawn');
  const result = await attempt.settlement;
  if (result.status !== 'spawn_accepted') throw new Error('Expected accepted spawn.');
  return { attempt, child, dispatch, process: result.process };
};

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
  mocks.canonicalize.mockReset();
  mocks.readFile.mockReset();
  mocks.readlink.mockReset();
  mocks.spawn.mockReset();
  mocks.stat.mockReset();
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

test('settles accepted carriers synchronously before the awaiting caller inspects identity', async () => {
  prepareInspection();
  const dispatch = new NodePosixProcessSpawnDispatch();
  const { process } = await acceptedProcess(dispatch);

  await expect(dispatch.inspectIdentity(process, Date.now() + 1_000)).resolves.toEqual({
    status: 'identified',
    identity: {
      pid: 42,
      processGroupId: 42,
      fingerprint: `sha256:${createHash('sha256').update('{"fixture":true}', 'utf8').digest('hex')}`,
    },
  });
});

test('unregistered accepted process carriers fail identity inspection without throwing', async () => {
  const attempt = createProcessStartAttempt({ invocationId: 'spawn-dispatch-test' });
  const token = getProcessStartInvocationToken(attempt);
  if (token === undefined) throw new Error('Expected process start invocation token.');
  const process = SpawnAcceptedProcess.create({
    invocationId: 'spawn-dispatch-test',
    spawnedAt: Date.now(),
    invocationToken: token,
  });

  await expect(
    new NodePosixProcessSpawnDispatch().inspectIdentity(process, Date.now() + 1_000),
  ).resolves.toEqual({
    status: 'failed',
    reason: 'inspection_failed',
  });
});

test('deadline wins when identity inspection does not complete before the active-state deadline', async () => {
  mocks.readFile.mockImplementation(async () => new Promise<string>(() => undefined));
  const { dispatch, process } = await acceptedProcess();

  await expect(dispatch.inspectIdentity(process, Date.now() - 1)).resolves.toEqual({
    status: 'failed',
    reason: 'deadline',
  });
});

test.each([
  [
    'proc stat read fails',
    (): void => {
      mocks.readFile.mockRejectedValue(new Error('stat unavailable'));
    },
  ],
  [
    'stat command delimiter is missing',
    (): void => {
      prepareInspection('1 reference-child without-closing-delimiter');
    },
  ],
  [
    'process-group-id field is missing',
    (): void => {
      prepareInspection('1 (reference-child) S');
    },
  ],
  [
    'process-group-id field is non-numeric',
    (): void => {
      prepareInspection(statLine('not-a-group', '123'));
    },
  ],
  [
    'process-group-id field is unsafe',
    (): void => {
      prepareInspection(statLine('9007199254740992', '123'));
    },
  ],
  [
    'creation-identity field is missing',
    (): void => {
      prepareInspection('1 (reference-child) S 1 42 1 1 1');
    },
  ],
  [
    'creation-identity field is malformed',
    (): void => {
      prepareInspection(statLine('42', 'not-a-creation-identity'));
    },
  ],
  [
    'readlink of executable fails',
    (): void => {
      prepareInspection();
      mocks.readlink.mockRejectedValue(new Error('exe unavailable'));
    },
  ],
  [
    'resolved executable path is not absolute',
    (): void => {
      prepareInspection();
      mocks.readlink.mockResolvedValue('relative-agent');
    },
  ],
  [
    'executable stat fails',
    (): void => {
      prepareInspection();
      mocks.stat.mockRejectedValue(new Error('executable removed'));
    },
  ],
  [
    'boot id read fails',
    (): void => {
      prepareInspection();
      mocks.readFile.mockImplementation(async (path: string) => {
        if (path.endsWith('/stat')) return statLine('42', '123');
        throw new Error('boot id unavailable');
      });
    },
  ],
  [
    'boot id is empty',
    (): void => {
      prepareInspection();
      mocks.readFile.mockImplementation(async (path: string) =>
        path.endsWith('/stat') ? statLine('42', '123') : '\n',
      );
    },
  ],
  [
    'detached child is not its own process-group leader',
    (): void => {
      prepareInspection(statLine('41', '123'));
    },
  ],
] as const)('maps %s to inspection_failed', async (_name, arrange) => {
  arrange();
  const { dispatch, process } = await acceptedProcess();

  await expect(dispatch.inspectIdentity(process, Date.now() + 1_000)).resolves.toEqual({
    status: 'failed',
    reason: 'inspection_failed',
  });
});

test('maps fingerprint canonicalization failure to fingerprint_failed', async () => {
  prepareInspection();
  mocks.canonicalize.mockReturnValue(undefined);
  const { dispatch, process } = await acceptedProcess();

  await expect(dispatch.inspectIdentity(process, Date.now() + 1_000)).resolves.toEqual({
    status: 'failed',
    reason: 'fingerprint_failed',
  });
});

test('settleProcessStart synchronously returns the accepted carrier result', () => {
  const attempt = createProcessStartAttempt({ invocationId: 'spawn-dispatch-test' });

  const settled = settleProcessStart(attempt, { status: 'accepted', spawnedAt: 123_456 });

  expect(settled?.status).toBe('spawn_accepted');
  if (settled?.status !== 'spawn_accepted') throw new Error('Expected accepted settlement.');
  expect(SpawnAcceptedProcess.isAuthentic(settled.process)).toBe(true);
  expect(PausedProcessIo.isAuthentic(settled.io)).toBe(true);
});
