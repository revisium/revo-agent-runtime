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
    executable: '/fixture/bin/agent',
    args: Object.freeze([]),
    environment: Object.freeze({}),
    shell: false as const,
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

const startWith = (child: FakeChild): Promise<unknown> => {
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

test('rejects unsupported hosts before spawn', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');

  await expect(new NodePosixProcessSupervisionPort().start(request())).rejects.toThrow(
    'unavailable on win32',
  );
  expect(mocks.spawn).not.toHaveBeenCalled();
});

test('rejects a child without a positive pid', async () => {
  const child = new FakeChild(undefined);
  mocks.spawn.mockReturnValue(child);
  const starting = new NodePosixProcessSupervisionPort().start(request());
  child.emit('spawn');

  await expect(starting).rejects.toThrow('did not provide a positive child process id');
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
