import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readlink, stat } from 'node:fs/promises';

import canonicalize from 'canonicalize';

import type {
  LiveOwnedProcess,
  ProcessExitObservation,
  ProcessIdentity,
  ProcessOutputSink,
  ProcessStartRequest,
  ProcessSupervisionPort,
} from '../../runtime/execution/index.js';
import { AGENT_MANAGER_LIMITS } from '../../runtime/policy/index.js';
import { terminateProcessGroupAndReap } from './posix-process-group-termination.js';

interface LinuxProcessFingerprintRecord {
  readonly schemaVersion: 'process-fingerprint/v1';
  readonly platform: 'linux';
  readonly pid: number;
  readonly processGroupId: number;
  readonly creationIdentity: string;
  readonly executablePath: string;
  readonly executableIdentity: string;
  readonly bootSessionIdentity: string;
}

type ProcessIdentityInspector = (pid: number) => Promise<ProcessIdentity>;

interface NodePosixProcessSupervisionPortOptions {
  readonly inspect?: ProcessIdentityInspector;
}

const terminationGraceMs = AGENT_MANAGER_LIMITS.processTerminationGraceMs;
const postKillReapTimeoutMs = AGENT_MANAGER_LIMITS.processPostKillReapTimeoutMs;
const terminationPollMs = 10;

const positiveSafeInteger = (value: string | undefined, field: string): number => {
  if (value === undefined || !/^[1-9]\d*$/u.test(value))
    throw new Error(`Linux process inspection did not provide a positive ${field}.`);

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new Error(`Linux process inspection provided an unsafe ${field}.`);

  return parsed;
};

const linuxProcessFields = async (pid: number): Promise<readonly string[]> => {
  const statLine = await readFile(`/proc/${pid}/stat`, 'utf8');
  const commandEnd = statLine.lastIndexOf(')');
  if (commandEnd < 0)
    throw new Error('Linux process inspection could not delimit the command name.');

  return statLine
    .slice(commandEnd + 1)
    .trim()
    .split(/\s+/u);
};

const fingerprint = (record: LinuxProcessFingerprintRecord): string => {
  const canonical = canonicalize(record);
  if (canonical === undefined)
    throw new Error('Linux process fingerprint record could not canonicalize.');

  return `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
};

const inspectLinuxProcess = async (pid: number): Promise<ProcessIdentity> => {
  const fields = await linuxProcessFields(pid);
  const processGroupId = positiveSafeInteger(fields[2], 'process group id');
  const creationIdentity = fields[19];
  if (creationIdentity === undefined || !/^[1-9]\d*$/u.test(creationIdentity))
    throw new Error('Linux process inspection did not provide a stable creation identity.');

  const executablePath = await readlink(`/proc/${pid}/exe`);
  if (!executablePath.startsWith('/'))
    throw new Error('Linux process inspection did not provide an absolute executable path.');

  const executable = await stat(executablePath, { bigint: true });
  const bootSessionIdentity = (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
  if (bootSessionIdentity.length === 0)
    throw new Error('Linux process inspection did not provide a boot session identity.');

  const record: LinuxProcessFingerprintRecord = {
    schemaVersion: 'process-fingerprint/v1',
    platform: 'linux',
    pid,
    processGroupId,
    creationIdentity,
    executablePath,
    executableIdentity: `${executable.dev}:${executable.ino}`,
    bootSessionIdentity,
  };
  return Object.freeze({ pid, processGroupId, fingerprint: fingerprint(record) });
};

const closedInputSink = Object.freeze({
  write: (_chunk: Uint8Array): Promise<void> =>
    Promise.reject(new Error('Process stdin is unavailable.')),
  end: (): Promise<void> => Promise.resolve(),
  abort: (): Promise<void> => Promise.resolve(),
});

const awaitSpawn = async (child: ReturnType<typeof spawn>): Promise<void> =>
  new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });

const awaitClose = (child: ReturnType<typeof spawn>): Promise<ProcessExitObservation> =>
  new Promise((resolve, reject) => {
    child.once('close', (exitCode: number | null, signal: NodeJS.Signals | null) =>
      resolve(Object.freeze({ exitCode, signal })),
    );
    child.once('error', reject);
  });

const copyEnvironment = (
  environment: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> => {
  const entries = Object.entries(environment);
  if (entries.some(([, value]) => typeof value !== 'string'))
    throw new Error('Process environment values must be strings.');

  return Object.freeze(Object.fromEntries(entries));
};

const assertOutputSink: (value: unknown, name: string) => asserts value is ProcessOutputSink = (
  value,
  name,
) => {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('write' in value) ||
    typeof value.write !== 'function' ||
    !('end' in value) ||
    typeof value.end !== 'function'
  )
    throw new Error(`${name} output sink must provide write and end functions.`);
};

const terminateAndReap = (
  processGroupId: number,
  completion: Promise<ProcessExitObservation>,
): Promise<void> =>
  terminateProcessGroupAndReap(processGroupId, completion, {
    terminationGraceMs,
    postKillReapTimeoutMs,
    terminationPollMs,
  });

export class NodePosixProcessSupervisionPort implements ProcessSupervisionPort {
  private readonly inspect: ProcessIdentityInspector;

  constructor(options: NodePosixProcessSupervisionPortOptions = {}) {
    this.inspect = options.inspect ?? inspectLinuxProcess;
  }

  async start(request: ProcessStartRequest): Promise<LiveOwnedProcess> {
    if (process.platform !== 'linux')
      throw new Error(`Node POSIX process inspection is unavailable on ${process.platform}.`);
    if (request.stdout === undefined || request.stderr === undefined)
      throw new Error('Process output sinks are mandatory.');
    assertOutputSink(request.stdout, 'stdout');
    assertOutputSink(request.stderr, 'stderr');

    const environment = copyEnvironment(request.environment);
    const child = spawn(request.executable, [...request.args], {
      cwd: request.cwd,
      detached: true,
      env: environment,
      shell: request.shell,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const completion = awaitClose(child);
    try {
      await awaitSpawn(child);
    } catch (error: unknown) {
      void completion.catch(() => undefined);
      throw error;
    }

    const pid = child.pid;
    if (pid === undefined || !Number.isSafeInteger(pid) || pid < 1)
      throw new Error('Node did not provide a positive child process id.');

    let cleanup: Promise<void> | undefined;
    const cleanupProcess = (): Promise<void> => {
      cleanup ??= terminateAndReap(pid, completion);
      return cleanup;
    };

    const outputCompletion = Promise.all([
      this.pump(child.stdout, request.stdout),
      this.pump(child.stderr, request.stderr),
    ]).catch(async (error: unknown) => {
      try {
        await cleanupProcess();
      } catch (cleanupError: unknown) {
        const failure = new AggregateError(
          [error, cleanupError],
          'Process output delivery and cleanup both failed.',
          { cause: cleanupError },
        );
        throw failure;
      }
      throw error;
    });
    void outputCompletion.catch(() => undefined);

    let identity: ProcessIdentity;
    try {
      identity = await this.inspect(pid);
      if (identity.processGroupId !== pid)
        throw new Error('Detached child did not become the leader of its own process group.');
    } catch (error: unknown) {
      try {
        await cleanupProcess();
      } catch (cleanupError: unknown) {
        const failure = new AggregateError(
          [error, cleanupError],
          'Post-spawn process identity capture and cleanup both failed.',
          { cause: cleanupError },
        );
        throw failure;
      }
      throw error;
    }

    const observedCompletion = completion.then(async (observation) => {
      await outputCompletion;
      return observation;
    });
    return Object.freeze({
      spawnedAt: Date.now(),
      identity,
      stdin: closedInputSink,
      completion: observedCompletion,
      terminateAndReap: cleanupProcess,
    });
  }

  private async pump(
    stream: NonNullable<ReturnType<typeof spawn>['stdout']> | null | undefined,
    sink: ProcessOutputSink,
  ): Promise<void> {
    if (stream === null || stream === undefined) return sink.end();
    for await (const chunk of stream)
      await sink.write(typeof chunk === 'string' ? Buffer.from(chunk) : new Uint8Array(chunk));
    await sink.end();
  }
}
