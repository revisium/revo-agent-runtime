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
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('node:fs/promises', () => ({
  readFile: mocks.readFile,
  readlink: mocks.readlink,
  stat: mocks.stat,
}));

import { NodePosixProcessSupervisionPort } from '../../../src/platform/process/index.js';

class FakeChild extends EventEmitter {
  pid: number | undefined;

  constructor(pid: number | undefined) {
    super();
    this.pid = pid;
  }
}

const request = () =>
  Object.freeze({
    cwd: process.cwd(),
    executable: '/fixture/bin/agent',
    args: Object.freeze([]),
    environment: Object.freeze({}),
    shell: false as const,
    stdout: Object.freeze({
      write: async (_chunk: Uint8Array): Promise<void> => undefined,
      end: async (): Promise<void> => undefined,
    }),
    stderr: Object.freeze({
      write: async (_chunk: Uint8Array): Promise<void> => undefined,
      end: async (): Promise<void> => undefined,
    }),
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

const gone = (): Error & { readonly code: 'ESRCH' } =>
  Object.assign(new Error('process group is absent'), { code: 'ESRCH' as const });

const releaseClose = async (child: FakeChild): Promise<void> => {
  await vi.waitFor(() => expect(mocks.readFile).toHaveBeenCalled());
  child.emit('close');
};

const prepareInspection = (statValue: string): void => {
  mocks.readFile.mockClear();
  mocks.readFile.mockImplementation(async (path: string) =>
    path.endsWith('/stat') ? statValue : 'boot-session\n',
  );
  mocks.readlink.mockResolvedValue('/fixture/bin/agent');
  mocks.stat.mockResolvedValue({ dev: 1n, ino: 2n });
  mocks.canonicalize.mockReturnValue('{"fixture":true}');
};

const startWith = (child: FakeChild): ReturnType<NodePosixProcessSupervisionPort['start']> => {
  mocks.spawn.mockReturnValue(child);
  const starting = new NodePosixProcessSupervisionPort().start(request());
  child.emit('spawn');
  return starting;
};

const startWithInspector = (
  child: FakeChild,
  inspect: (pid: number) => Promise<never>,
): Promise<unknown> => {
  mocks.spawn.mockReturnValue(child);
  const starting = new NodePosixProcessSupervisionPort({ inspect }).start(request());
  child.emit('spawn');
  return starting;
};

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

afterEach(() => {
  mocks.canonicalize.mockReset();
  mocks.readFile.mockReset();
  mocks.readlink.mockReset();
  mocks.spawn.mockReset();
  mocks.stat.mockReset();
  vi.restoreAllMocks();
});

test('rejects malformed proc records after owned cleanup', async () => {
  vi.spyOn(process, 'kill').mockImplementation(() => {
    throw gone();
  });
  prepareInspection('1 reference-child without-closing-delimiter');
  const child = new FakeChild(401);
  const starting = startWith(child);
  await releaseClose(child);

  await expect(starting).rejects.toThrow('could not delimit the command name');
});

test('passes an approved workspace as the child working directory', async () => {
  vi.spyOn(process, 'kill').mockImplementation(() => {
    throw gone();
  });
  prepareInspection(statLine('408', '1'));
  const child = new FakeChild(408);
  mocks.spawn.mockReturnValue(child);
  const starting = new NodePosixProcessSupervisionPort().start({
    ...request(),
    cwd: '/approved/workspace',
  });
  child.emit('spawn');
  await releaseClose(child);
  await expect(starting).resolves.toBeDefined();
  expect(mocks.spawn).toHaveBeenCalledWith(
    '/fixture/bin/agent',
    [],
    expect.objectContaining({ cwd: '/approved/workspace' }),
  );
});

test('rejects missing and unsafe process identities after owned cleanup', async () => {
  vi.spyOn(process, 'kill').mockImplementation(() => {
    throw gone();
  });
  prepareInspection('1 (reference-child) S');
  const missing = new FakeChild(402);
  const missingStart = startWith(missing);
  await releaseClose(missing);
  await expect(missingStart).rejects.toThrow('positive process group id');

  prepareInspection(statLine('9007199254740992', '1'));
  const unsafe = new FakeChild(403);
  const unsafeStart = startWith(unsafe);
  await releaseClose(unsafe);
  await expect(unsafeStart).rejects.toThrow('unsafe process group id');
});

test('rejects invalid fingerprint inputs after owned cleanup', async () => {
  vi.spyOn(process, 'kill').mockImplementation(() => {
    throw gone();
  });
  prepareInspection(statLine('404', 'not-a-creation-identity'));
  const creation = new FakeChild(404);
  const creationStart = startWith(creation);
  await releaseClose(creation);
  await expect(creationStart).rejects.toThrow('stable creation identity');

  prepareInspection(statLine('405', '1'));
  mocks.readlink.mockResolvedValue('relative-agent');
  const relativePath = new FakeChild(405);
  const relativeStart = startWith(relativePath);
  await releaseClose(relativePath);
  await expect(relativeStart).rejects.toThrow('absolute executable path');

  prepareInspection(statLine('406', '1'));
  mocks.readFile.mockImplementation(async (path: string) =>
    path.endsWith('/stat') ? statLine('406', '1') : '\n',
  );
  const emptyBoot = new FakeChild(406);
  const emptyBootStart = startWith(emptyBoot);
  await releaseClose(emptyBoot);
  await expect(emptyBootStart).rejects.toThrow('boot session identity');

  prepareInspection(statLine('407', '1'));
  mocks.canonicalize.mockReturnValue(undefined);
  const uncanonicalizable = new FakeChild(407);
  const uncanonicalizableStart = startWith(uncanonicalizable);
  await releaseClose(uncanonicalizable);
  await expect(uncanonicalizableStart).rejects.toThrow('could not canonicalize');
});

test('rejects non-string environment values before spawn', async () => {
  const environment: Record<string, string> = {};
  Object.defineProperty(environment, 'INVALID', { enumerable: true, value: 1 });

  await expect(
    new NodePosixProcessSupervisionPort().start({ ...request(), environment }),
  ).rejects.toThrow('environment values must be strings');
  expect(mocks.spawn).not.toHaveBeenCalled();
});

test('rejects malformed output sinks before spawn', async () => {
  const malformedRequest: unknown = {
    ...request(),
    stdout: { write: async (): Promise<void> => undefined },
  };
  const port = new NodePosixProcessSupervisionPort();
  const start = port.start.bind(port);

  await expect(Reflect.apply(start, port, [malformedRequest])).rejects.toThrow(
    'stdout output sink must provide write and end functions',
  );
  expect(mocks.spawn).not.toHaveBeenCalled();
});

test('observes immediate output rejection while identity inspection is delayed', async () => {
  vi.spyOn(process, 'kill').mockImplementation(() => {
    throw gone();
  });
  const child = new FakeChild(414);
  const outputFailure = new Error('output delivery failed');
  let unhandledRejection: unknown;
  const onUnhandledRejection = (reason: unknown): void => {
    unhandledRejection = reason;
  };
  process.once('unhandledRejection', onUnhandledRejection);
  let releaseInspection: (identity: {
    readonly pid: number;
    readonly processGroupId: number;
    readonly fingerprint: string;
  }) => void = () => undefined;
  const inspection = new Promise<{
    readonly pid: number;
    readonly processGroupId: number;
    readonly fingerprint: string;
  }>((resolve) => {
    releaseInspection = resolve;
  });
  const outputRejectingRequest = {
    ...request(),
    stdout: Object.freeze({
      write: async (_chunk: Uint8Array): Promise<void> => undefined,
      end: async (): Promise<void> => {
        throw outputFailure;
      },
    }),
  };

  mocks.spawn.mockReturnValue(child);
  const starting = new NodePosixProcessSupervisionPort({
    inspect: async () => inspection,
  }).start(outputRejectingRequest);
  child.emit('spawn');

  await wait(50);
  child.emit('close');
  releaseInspection({
    pid: 414,
    processGroupId: 414,
    fingerprint: '{"fixture":true}',
  });

  const live = await starting;
  await expect(live.completion).rejects.toBe(outputFailure);
  process.removeListener('unhandledRejection', onUnhandledRejection);
  expect(unhandledRejection).toBeUndefined();
});

test('rejects unsupported hosts before spawn', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');

  await expect(new NodePosixProcessSupervisionPort().start(request())).rejects.toThrow(
    'unavailable on win32',
  );
  expect(mocks.spawn).not.toHaveBeenCalled();
});

test('rejects spawn errors without an unhandled completion rejection', async () => {
  const child = new FakeChild(undefined);
  const failure = new Error('spawn failed');
  mocks.spawn.mockReturnValue(child);

  const starting = new NodePosixProcessSupervisionPort().start(request());
  child.emit('error', failure);

  await expect(starting).rejects.toBe(failure);
});

test('rejects a child without a positive pid', async () => {
  const child = new FakeChild(undefined);
  mocks.spawn.mockReturnValue(child);
  const starting = new NodePosixProcessSupervisionPort().start(request());
  child.emit('spawn');

  await expect(starting).rejects.toThrow('did not provide a positive child process id');
});

test('resolves completion when the child closes synchronously during spawn emission', async () => {
  const child = new FakeChild(413);
  prepareInspection(statLine('413', '1'));
  child.once('spawn', () => child.emit('close'));

  const live = await startWith(child);

  await expect(
    Promise.race([
      live.completion.then(() => 'closed'),
      new Promise((resolve) => {
        setTimeout(() => resolve('pending'), 0);
      }),
    ]),
  ).resolves.toBe('closed');
});

test('escalates a still-live owned group to SIGKILL before reaping its leader', async () => {
  let killed = false;
  const kill = vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
    if (signal === 'SIGTERM') return true;
    if (signal === 'SIGKILL') {
      killed = true;
      return true;
    }
    if (signal === 0 && killed) throw gone();
    return true;
  });
  const inspect = vi.fn(async (): Promise<never> => {
    throw new Error('inspection failed');
  });
  const child = new FakeChild(408);
  const starting = startWithInspector(child, inspect);

  await vi.waitFor(() => expect(inspect).toHaveBeenCalled());
  await wait(300);
  child.emit('close');
  await expect(starting).rejects.toThrow('inspection failed');
  expect(kill).toHaveBeenCalledWith(-408, 'SIGTERM');
  expect(kill).toHaveBeenCalledWith(-408, 'SIGKILL');
});

test('fails closed when the owned group survives SIGKILL', async () => {
  const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
  const inspect = vi.fn(async (): Promise<never> => {
    throw new Error('inspection failed');
  });
  const child = new FakeChild(409);
  const starting = startWithInspector(child, inspect);

  await expect(starting).rejects.toThrow(
    'Post-spawn process identity capture and cleanup both failed',
  );
  expect(kill).toHaveBeenCalledWith(-409, 'SIGKILL');
});

test('fails closed when the group disappears but the leader does not close', async () => {
  vi.spyOn(process, 'kill').mockImplementation(() => {
    throw gone();
  });
  const inspect = vi.fn(async (): Promise<never> => {
    throw new Error('inspection failed');
  });
  const child = new FakeChild(410);
  const starting = startWithInspector(child, inspect);

  await expect(starting).rejects.toThrow(
    'Post-spawn process identity capture and cleanup both failed',
  );
});

test('preserves inspection and cleanup errors when a process-group helper fails', async () => {
  vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
    if (signal === 'SIGTERM') throw gone();
    throw new Error('group check failed');
  });
  const inspect = vi.fn(async (): Promise<never> => {
    throw new Error('inspection failed');
  });
  const child = new FakeChild(411);
  const starting = startWithInspector(child, inspect);

  await expect(starting).rejects.toMatchObject({
    errors: [
      expect.objectContaining({ message: 'inspection failed' }),
      expect.objectContaining({ message: 'group check failed' }),
    ],
    message: 'Post-spawn process identity capture and cleanup both failed.',
  });
});

test('preserves inspection and cleanup errors when the first group signal fails', async () => {
  vi.spyOn(process, 'kill').mockImplementation(() => {
    throw new Error('signal failed');
  });
  const inspect = vi.fn(async (): Promise<never> => {
    throw new Error('inspection failed');
  });
  const child = new FakeChild(412);
  const starting = startWithInspector(child, inspect);

  await expect(starting).rejects.toMatchObject({
    errors: [
      expect.objectContaining({ message: 'inspection failed' }),
      expect.objectContaining({ message: 'signal failed' }),
    ],
    message: 'Post-spawn process identity capture and cleanup both failed.',
  });
});
