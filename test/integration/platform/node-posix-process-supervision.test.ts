import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readlink, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import canonicalize from 'canonicalize';
import { expect, test } from 'vitest';

import { NodePosixProcessSupervisionPort } from '../../../src/platform/process/index.js';

const fixturePath = fileURLToPath(
  new URL('../../fixtures/process/reference-child.sh', import.meta.url),
);

const recordEnvironment = [
  "import { writeFile } from 'node:fs/promises';",
  'await writeFile(process.argv[1], JSON.stringify(process.env));',
  'setTimeout(() => {}, 250);',
].join(' ');

const readLinuxProcessRecord = async (pid: number, processGroupId: number) => {
  const statLine = await readFile(`/proc/${pid}/stat`, 'utf8');
  const commandEnd = statLine.lastIndexOf(')');
  if (commandEnd < 0) throw new Error('Reference child stat record has no command terminator.');
  const fields = statLine
    .slice(commandEnd + 1)
    .trim()
    .split(/\s+/u);
  const creationIdentity = fields[19];
  const actualGroupId = Number(fields[2]);
  if (creationIdentity === undefined || actualGroupId !== processGroupId)
    throw new Error('Reference child stat record does not match the observed process group.');

  const executablePath = await readlink(`/proc/${pid}/exe`);
  const executable = await stat(executablePath, { bigint: true });
  const bootSessionIdentity = (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();

  return {
    schemaVersion: 'process-fingerprint/v1' as const,
    platform: 'linux' as const,
    pid,
    processGroupId,
    creationIdentity,
    executablePath,
    executableIdentity: `${executable.dev}:${executable.ino}`,
    bootSessionIdentity,
  };
};

const waitForFileAttempt = async (path: string, attemptsRemaining: number): Promise<string> => {
  try {
    const content = await readFile(path, 'utf8');
    if (content !== '') return content;
  } catch (error: unknown) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
  }

  if (attemptsRemaining === 1) throw new Error(`Reference child did not populate ${path}.`);

  await delay(10);
  return waitForFileAttempt(path, attemptsRemaining - 1);
};

const waitForFile = (path: string): Promise<string> => waitForFileAttempt(path, 50);

const ignoredOutput = () =>
  Object.freeze({
    write: async (_chunk: Uint8Array): Promise<void> => undefined,
    end: async (): Promise<void> => undefined,
  });

const expectProcessGroupAbsent = (processGroupId: number): void => {
  try {
    process.kill(-processGroupId, 0);
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return;
    throw error;
  }

  throw new Error(`Process group ${processGroupId} is still live.`);
};

test.runIf(process.platform === 'linux')(
  'rejects a process start that omits mandatory output sinks before spawning',
  async () => {
    const port = new NodePosixProcessSupervisionPort();
    const malformedRequest: unknown = {
      executable: process.execPath,
      args: ['--input-type=module', '--eval', 'process.exit(0)'],
      shell: false,
      environment: Object.freeze({}),
    };

    const start = port.start.bind(port);
    await expect(Reflect.apply(start, port, [malformedRequest])).rejects.toThrow(
      'Process output sinks are mandatory.',
    );
  },
);

test.runIf(process.platform === 'linux')(
  'rejects malformed output sinks before a child can create evidence',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'revo-process-supervision-'));
    try {
      const markerPath = join(directory, 'child-created-marker');
      const malformedRequest: unknown = {
        executable: process.execPath,
        args: [
          '--input-type=module',
          '--eval',
          "import { writeFile } from 'node:fs/promises'; await writeFile(process.argv[1], 'created');",
          markerPath,
        ],
        shell: false,
        environment: Object.freeze({}),
        stdout: { write: async (): Promise<void> => undefined },
        stderr: ignoredOutput(),
      };
      const port = new NodePosixProcessSupervisionPort();
      const start = port.start.bind(port);

      await expect(Reflect.apply(start, port, [malformedRequest])).rejects.toThrow(
        'stdout output sink must provide write and end functions',
      );
      await expect(readFile(markerPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  },
);

test.runIf(process.platform === 'linux')(
  'waits for a reference child file to be populated after it is created',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'revo-process-supervision-'));
    try {
      const path = join(directory, 'delayed-record');
      const writer = (async (): Promise<void> => {
        await writeFile(path, '');
        await delay(20);
        await writeFile(path, 'complete');
      })();

      const content = await waitForFile(path);
      await writer;
      expect(content).toBe('complete');
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  },
);

test.runIf(process.platform === 'linux')(
  'does not complete before ordered stdout delivery has drained',
  async () => {
    const delivered: string[] = [];
    const sink = {
      write: async (chunk: Uint8Array): Promise<void> => {
        await delay(delivered.length === 0 ? 30 : 0);
        delivered.push(Buffer.from(chunk).toString('utf8'));
      },
      end: async (): Promise<void> => undefined,
    };
    const port = new NodePosixProcessSupervisionPort();
    const ownedProcess = await port.start({
      cwd: process.cwd(),
      executable: process.execPath,
      args: [
        '--input-type=module',
        '--eval',
        "process.stdout.write('first'); process.stdout.write('second');",
      ],
      shell: false,
      environment: Object.freeze({}),
      stdout: sink,
      stderr: ignoredOutput(),
    });

    await expect(ownedProcess.completion).resolves.toEqual({ exitCode: 0, signal: null });
    expect(delivered.join('')).toBe('firstsecond');
  },
);

test.runIf(process.platform === 'linux')(
  'fails closed and reaps the group when stdout delivery rejects',
  async () => {
    const port = new NodePosixProcessSupervisionPort();
    const ownedProcess = await port.start({
      cwd: process.cwd(),
      executable: process.execPath,
      args: [
        '--input-type=module',
        '--eval',
        "process.stdout.write('reject-me'); setTimeout(() => {}, 5000);",
      ],
      shell: false,
      environment: Object.freeze({}),
      stdout: {
        write: async (): Promise<void> => {
          throw new Error('stdout sink failed');
        },
        end: async (): Promise<void> => undefined,
      },
      stderr: ignoredOutput(),
    });

    await expect(ownedProcess.completion).rejects.toThrow('stdout sink failed');
    expectProcessGroupAbsent(ownedProcess.identity.processGroupId);
  },
);

test.runIf(process.platform === 'linux')(
  'captures a candidate-host reference child in its own group with a canonical OS fingerprint',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'revo-process-supervision-'));
    try {
      const environmentPath = join(directory, 'environment.json');
      const port = new NodePosixProcessSupervisionPort();
      const ownedProcess = await port.start({
        cwd: process.cwd(),
        executable: process.execPath,
        args: ['--input-type=module', '--eval', recordEnvironment, environmentPath],
        shell: false,
        environment: Object.freeze({ REFERENCE_PROCESS_ENV: 'candidate' }),
        stdout: ignoredOutput(),
        stderr: ignoredOutput(),
      });

      expect(ownedProcess.identity.processGroupId).toBe(ownedProcess.identity.pid);
      const record = await readLinuxProcessRecord(
        ownedProcess.identity.pid,
        ownedProcess.identity.processGroupId,
      );
      const canonical = canonicalize(record);
      if (canonical === undefined)
        throw new Error('Reference fingerprint record did not canonicalize.');
      const expectedFingerprint = `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
      expect(ownedProcess.identity.fingerprint).toBe(expectedFingerprint);
      await expect(waitForFile(environmentPath)).resolves.toBe(
        JSON.stringify({ REFERENCE_PROCESS_ENV: 'candidate' }),
      );

      await expect(ownedProcess.completion).resolves.toEqual({ exitCode: 0, signal: null });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  },
);

test.runIf(process.platform === 'linux')(
  'kills and reaps a long-running reference child group through its private live capability',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'revo-process-supervision-'));
    let ownedProcess: Awaited<ReturnType<NodePosixProcessSupervisionPort['start']>> | undefined;
    try {
      const descendantPidPath = join(directory, 'descendant.pid');
      const port = new NodePosixProcessSupervisionPort();
      ownedProcess = await port.start({
        cwd: process.cwd(),
        executable: '/bin/sh',
        args: [fixturePath, '', descendantPidPath, '5'],
        shell: false,
        environment: Object.freeze({}),
        stdout: ignoredOutput(),
        stderr: ignoredOutput(),
      });
      await expect(waitForFile(descendantPidPath)).resolves.toMatch(/^\d+$/u);

      await expect(ownedProcess.terminateAndReap()).resolves.toBeUndefined();
      await expect(ownedProcess.completion).resolves.toEqual({ exitCode: null, signal: 'SIGTERM' });
      expectProcessGroupAbsent(ownedProcess.identity.processGroupId);
    } finally {
      if (ownedProcess !== undefined) await ownedProcess.terminateAndReap().catch(() => undefined);
      await rm(directory, { force: true, recursive: true });
    }
  },
);

test.runIf(process.platform === 'linux')(
  'cleans up the owned group when a deterministic process-group invariant check fails',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'revo-process-supervision-'));
    try {
      const leaderPidPath = join(directory, 'leader.pid');
      const port = new NodePosixProcessSupervisionPort({
        inspect: async (pid) => {
          await expect(waitForFile(leaderPidPath)).resolves.toBe(String(pid));
          return Object.freeze({
            pid,
            processGroupId: pid + 1,
            fingerprint: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
          });
        },
      });
      const starting = port.start({
        cwd: process.cwd(),
        executable: '/bin/sh',
        args: [fixturePath, '', '', '5', leaderPidPath],
        shell: false,
        environment: Object.freeze({}),
        stdout: ignoredOutput(),
        stderr: ignoredOutput(),
      });

      await expect(starting).rejects.toThrow(
        'Detached child did not become the leader of its own process group.',
      );
      const processGroupId = Number(await waitForFile(leaderPidPath));
      expectProcessGroupAbsent(processGroupId);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  },
);
