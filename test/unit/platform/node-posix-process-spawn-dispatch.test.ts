import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';

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
  DuplexCoordinatorRegistration,
  getProcessStartInvocationToken,
  PausedProcessIo,
  SpawnAcceptedProcess,
  settleProcessStart,
  type ProcessIdentity,
  type ProcessOutputSink,
  type ProcessSpawnRequest,
} from '../../../src/runtime/execution/index.js';

class FakeReadable extends EventEmitter {
  readonly onCalls: string[] = [];
  readonly pipeCalls: unknown[] = [];
  readonly resume = vi.fn();
  readonly iterator = vi.fn();
  chunks: Uint8Array[] = [];

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
    const chunks = this.chunks;
    return (async function* queued(): AsyncIterableIterator<Uint8Array> {
      yield* chunks;
    })();
  }
}

class FakeWritable extends Writable {
  readonly writes: Uint8Array[] = [];

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.writes.push(typeof chunk === 'string' ? Buffer.from(chunk) : new Uint8Array(chunk));
    callback();
  }
}

class FakeChild extends EventEmitter {
  readonly stdout = new FakeReadable();
  readonly stderr = new FakeReadable();
  readonly stdin = new FakeWritable();
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
    stdout: child.stdout,
    stderr: child.stderr,
    evidenceStdout: spawnRequest.stdout,
    evidenceStderr: spawnRequest.stderr,
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

const textEncoder = new TextEncoder();

const coordinatorFor = (
  attempt: ReturnType<typeof createProcessStartAttempt>,
): DuplexCoordinatorRegistration => {
  const token = getProcessStartInvocationToken(attempt);
  if (token === undefined) throw new Error('Expected process start invocation token.');
  return DuplexCoordinatorRegistration.create({
    invocationId: attempt.invocationId,
    invocationToken: token,
  });
};

const identityFor = (child: FakeChild): ProcessIdentity =>
  Object.freeze({
    pid: child.pid ?? 42,
    processGroupId: child.pid ?? 42,
    fingerprint: 'sha256:test',
  });

const collectSink = (
  events: string[],
  label: string,
): ProcessOutputSink & { readonly chunks: Uint8Array[] } => {
  const chunks: Uint8Array[] = [];
  return Object.freeze({
    chunks,
    write: async (chunk: Uint8Array): Promise<void> => {
      events.push(`${label}:write:${new TextDecoder().decode(chunk)}`);
      chunks.push(new Uint8Array(chunk));
    },
    end: async (): Promise<void> => {
      events.push(`${label}:end`);
    },
  });
};

const waitFor = (predicate: () => boolean, attempts = 20): Promise<void> => {
  if (predicate()) return Promise.resolve();
  if (attempts < 1) return Promise.reject(new Error('Timed out waiting for async pump.'));
  return new Promise((resolve) => setImmediate(resolve)).then(() =>
    waitFor(predicate, attempts - 1),
  );
};

test('activateIo synchronously starts ordered independent stdout fan-out and stderr evidence pumping', async () => {
  const child = new FakeChild();
  child.stdout.chunks = [textEncoder.encode('stdout-a\n'), textEncoder.encode('stdout-b\n')];
  child.stderr.chunks = [textEncoder.encode('stderr\n')];
  mocks.spawn.mockReturnValue(child);
  const events: string[] = [];
  const stdout = collectSink(events, 'evidence-stdout');
  const stderr = collectSink(events, 'evidence-stderr');
  const protocol = collectSink(events, 'protocol-stdout');
  const attempt = createProcessStartAttempt({ invocationId: 'spawn-dispatch-test' });
  const dispatch = new NodePosixProcessSpawnDispatch();

  dispatch.beginStart(attempt, { ...request(), stdout, stderr });
  child.emit('spawn');
  const result = await attempt.settlement;
  if (result.status !== 'spawn_accepted') throw new Error('Expected accepted spawn.');

  const activation = dispatch.activateIo(
    result.process,
    result.io,
    identityFor(child),
    coordinatorFor(attempt),
    {
      secretValues: [],
      maxStdoutBytes: 1_000,
      maxStderrBytes: 1_000,
      protocolObserverSink: protocol,
    },
  );

  expect(activation).not.toBeInstanceOf(Promise);
  expect(activation.status).toBe('activated');
  await waitFor(() => events.filter((event) => event.endsWith(':end')).length === 3);
  expect(
    events.filter(
      (event) => event.startsWith('evidence-stdout') || event.startsWith('protocol-stdout'),
    ),
  ).toEqual([
    'evidence-stdout:write:stdout-a\n',
    'protocol-stdout:write:stdout-a\n',
    'evidence-stdout:write:stdout-b\n',
    'protocol-stdout:write:stdout-b\n',
    'evidence-stdout:end',
    'protocol-stdout:end',
  ]);
  expect(events).toContain('evidence-stderr:write:stderr\n');
  expect(events).toContain('evidence-stderr:end');
});

test('stdout redaction uses independent evidence and protocol channels', async () => {
  const child = new FakeChild();
  child.stdout.chunks = [textEncoder.encode('stdout-secret')];
  mocks.spawn.mockReturnValue(child);
  const events: string[] = [];
  const stdout = collectSink(events, 'evidence-stdout');
  const protocol = collectSink(events, 'protocol-stdout');
  const attempt = createProcessStartAttempt({ invocationId: 'spawn-dispatch-test' });
  const dispatch = new NodePosixProcessSpawnDispatch();

  dispatch.beginStart(attempt, { ...request(), stdout });
  child.emit('spawn');
  const result = await attempt.settlement;
  if (result.status !== 'spawn_accepted') throw new Error('Expected accepted spawn.');

  const activation = dispatch.activateIo(
    result.process,
    result.io,
    identityFor(child),
    coordinatorFor(attempt),
    {
      secretValues: ['secret'],
      maxStdoutBytes: 1_000,
      maxStderrBytes: 1_000,
      protocolObserverSink: protocol,
    },
  );

  expect(activation.status).toBe('activated');
  await waitFor(() => events.includes('protocol-stdout:end'));
  expect(events).toContain('evidence-stdout:write:stdout-[REDACTED]');
  expect(events).toContain('protocol-stdout:write:stdout-[REDACTED]');
});

test('activateIo rejects mismatched tokens and sequential double activation synchronously', async () => {
  const { attempt, child, dispatch, process } = await acceptedProcess();
  const firstResult = await attempt.settlement;
  if (firstResult.status !== 'spawn_accepted') throw new Error('Expected accepted spawn.');
  const otherAttempt = createProcessStartAttempt({ invocationId: 'other' });
  const otherToken = getProcessStartInvocationToken(otherAttempt);
  if (otherToken === undefined) throw new Error('Expected other token.');
  const mismatchedIo = PausedProcessIo.create({
    invocationId: 'other',
    invocationToken: otherToken,
  });

  const rejected = dispatch.activateIo(
    process,
    mismatchedIo,
    identityFor(child),
    coordinatorFor(attempt),
    {
      secretValues: [],
      maxStdoutBytes: 1_000,
      maxStderrBytes: 1_000,
    },
  );
  expect(rejected).not.toBeInstanceOf(Promise);
  expect(rejected).toEqual({ status: 'rejected', reason: 'internal_invariant_violation' });

  const activated = dispatch.activateIo(
    process,
    firstResult.io,
    identityFor(child),
    coordinatorFor(attempt),
    {
      secretValues: [],
      maxStdoutBytes: 1_000,
      maxStderrBytes: 1_000,
    },
  );
  expect(activated.status).toBe('activated');
  const doubleActivation = dispatch.activateIo(
    process,
    firstResult.io,
    identityFor(child),
    coordinatorFor(attempt),
    {
      secretValues: [],
      maxStdoutBytes: 1_000,
      maxStderrBytes: 1_000,
    },
  );
  expect(doubleActivation).not.toBeInstanceOf(Promise);
  expect(doubleActivation).toEqual({ status: 'rejected', reason: 'internal_invariant_violation' });
});

test('invalid activation sink options do not poison the exactly-once guard', async () => {
  const { attempt, child, dispatch, process } = await acceptedProcess();
  const result = await attempt.settlement;
  if (result.status !== 'spawn_accepted') throw new Error('Expected accepted spawn.');

  const invalid = dispatch.activateIo(
    process,
    result.io,
    identityFor(child),
    coordinatorFor(attempt),
    {
      secretValues: [],
      maxStdoutBytes: 0,
      maxStderrBytes: 1_000,
    },
  );
  expect(invalid).toEqual({ status: 'rejected', reason: 'internal_invariant_violation' });

  const valid = dispatch.activateIo(
    process,
    result.io,
    identityFor(child),
    coordinatorFor(attempt),
    {
      secretValues: [],
      maxStdoutBytes: 1_000,
      maxStderrBytes: 1_000,
    },
  );
  expect(valid.status).toBe('activated');
});

test('successful activation transfers start quiescence to coordinator and exposes stdin', async () => {
  const { attempt, child, dispatch, process } = await acceptedProcess();
  const result = await attempt.settlement;
  if (result.status !== 'spawn_accepted') throw new Error('Expected accepted spawn.');
  const activated = dispatch.activateIo(
    process,
    result.io,
    identityFor(child),
    coordinatorFor(attempt),
    {
      secretValues: [],
      maxStdoutBytes: 1_000,
      maxStderrBytes: 1_000,
    },
  );
  if (activated.status !== 'activated') throw new Error('Expected activation.');
  await activated.process.stdin.write(textEncoder.encode('hello'));
  await activated.process.stdin.end();

  expect(
    Buffer.concat(child.stdin.writes.map((chunk) => Buffer.from(chunk))).toString('utf8'),
  ).toBe('hello');
  await expect(attempt.quiescence).resolves.toEqual({
    status: 'quiescent',
    disposition: 'transferred_to_coordinator',
  });
  expect(activated.process.spawnedAt).toBe(process.spawnedAt);
});

test('stdout pump stops after the first fan-out write failure', async () => {
  const child = new FakeChild();
  child.stdout.chunks = [
    textEncoder.encode('first'),
    textEncoder.encode('second'),
    textEncoder.encode('third'),
  ];
  mocks.spawn.mockReturnValue(child);
  const events: string[] = [];
  const stdout = collectSink(events, 'evidence-stdout');
  const failingProtocol: ProcessOutputSink = Object.freeze({
    write: async (chunk: Uint8Array): Promise<void> => {
      events.push(`protocol-stdout:write:${new TextDecoder().decode(chunk)}`);
      if (events.some((event) => event === 'protocol-stdout:write:first'))
        throw new Error('sink failed');
    },
    end: async (): Promise<void> => {
      events.push('protocol-stdout:end');
    },
  });
  const attempt = createProcessStartAttempt({ invocationId: 'spawn-dispatch-test' });
  const dispatch = new NodePosixProcessSpawnDispatch();

  dispatch.beginStart(attempt, { ...request(), stdout });
  child.emit('spawn');
  const result = await attempt.settlement;
  if (result.status !== 'spawn_accepted') throw new Error('Expected accepted spawn.');
  const activated = dispatch.activateIo(
    result.process,
    result.io,
    identityFor(child),
    coordinatorFor(attempt),
    {
      secretValues: [],
      maxStdoutBytes: 1_000,
      maxStderrBytes: 1_000,
      protocolObserverSink: failingProtocol,
    },
  );

  expect(activated.status).toBe('activated');
  await waitFor(() => events.includes('protocol-stdout:write:first'));
  await new Promise((resolve) => setImmediate(resolve));
  expect(events).toEqual(['evidence-stdout:write:first', 'protocol-stdout:write:first']);
});
