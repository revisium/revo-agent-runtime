import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readlink, stat } from 'node:fs/promises';
import type { Readable } from 'node:stream';

import canonicalize from 'canonicalize';

import {
  beginProcessStart,
  createRedactingBoundedOutputSink,
  DuplexCoordinatorRegistration,
  getProcessStartInvocationToken,
  PausedProcessIo,
  settleProcessStart,
  settleProcessStartQuiescence,
  SpawnAcceptedProcess,
  type LiveOwnedProcess,
  type ProcessExitObservation,
  type ProcessIdentity,
  type ProcessIdentityInspectionResult,
  type ProcessInputSink,
  type ProcessIoActivationResult,
  type ProcessOutputSink,
  type ProcessSpawnRequest,
  type ProcessStartAttempt,
} from '../../runtime/execution/index.js';
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

interface NodePosixProcessSpawnHandle {
  readonly child: ChildProcessWithoutNullStreams;
  readonly stdout: ChildProcessWithoutNullStreams['stdout'];
  readonly stderr: ChildProcessWithoutNullStreams['stderr'];
  readonly evidenceStdout: ProcessOutputSink;
  readonly evidenceStderr: ProcessOutputSink;
  readonly spawnedAt: number;
  readonly attempt: ProcessStartAttempt;
  readonly completion: Promise<ProcessExitObservation>;
}

const PROCESS_SPAWN_HANDLES = new WeakMap<object, NodePosixProcessSpawnHandle>();
const ACTIVATED = new WeakSet<object>();
const terminationGraceMs = 2_000;
const postKillReapTimeoutMs = 2_000;
const terminationPollMs = 25;

const noopOutputSink: ProcessOutputSink = Object.freeze({
  write: async (_chunk: Uint8Array): Promise<void> => undefined,
  end: async (): Promise<void> => undefined,
});

const rejectedActivation = (): ProcessIoActivationResult =>
  Object.freeze({ status: 'rejected', reason: 'internal_invariant_violation' as const });

const failedInspection = (
  reason: Extract<ProcessIdentityInspectionResult, { status: 'failed' }>['reason'],
): ProcessIdentityInspectionResult => Object.freeze({ status: 'failed', reason });

const positiveSafeInteger = (value: string | undefined): number | undefined => {
  if (value === undefined || !/^[1-9]\d*$/u.test(value)) return undefined;

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return undefined;

  return parsed;
};

const linuxProcessFields = async (pid: number): Promise<readonly string[] | undefined> => {
  let statLine: string;
  try {
    statLine = await readFile(`/proc/${pid}/stat`, 'utf8');
  } catch {
    return undefined;
  }

  const commandEnd = statLine.lastIndexOf(')');
  if (commandEnd < 0) return undefined;

  return statLine
    .slice(commandEnd + 1)
    .trim()
    .split(/\s+/u);
};

const fingerprint = (record: LinuxProcessFingerprintRecord): string | undefined => {
  try {
    const canonical = canonicalize(record);
    if (canonical === undefined) return undefined;

    return `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
  } catch {
    return undefined;
  }
};

const inspectLinuxProcess = async (pid: number): Promise<ProcessIdentityInspectionResult> => {
  const fields = await linuxProcessFields(pid);
  if (fields === undefined) return failedInspection('inspection_failed');

  const processGroupId = positiveSafeInteger(fields[2]);
  if (processGroupId === undefined) return failedInspection('inspection_failed');

  const creationIdentity = fields[19];
  if (creationIdentity === undefined || !/^[1-9]\d*$/u.test(creationIdentity))
    return failedInspection('inspection_failed');

  let executablePath: string;
  try {
    executablePath = await readlink(`/proc/${pid}/exe`);
  } catch {
    return failedInspection('inspection_failed');
  }
  if (!executablePath.startsWith('/')) return failedInspection('inspection_failed');

  let executable: Awaited<ReturnType<typeof stat>>;
  try {
    executable = await stat(executablePath, { bigint: true });
  } catch {
    return failedInspection('inspection_failed');
  }

  let bootSessionIdentity: string;
  try {
    bootSessionIdentity = (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
  } catch {
    return failedInspection('inspection_failed');
  }
  if (bootSessionIdentity.length === 0) return failedInspection('inspection_failed');

  if (processGroupId !== pid) return failedInspection('inspection_failed');

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
  const processFingerprint = fingerprint(record);
  if (processFingerprint === undefined) return failedInspection('fingerprint_failed');

  const identity: ProcessIdentity = Object.freeze({
    pid,
    processGroupId,
    fingerprint: processFingerprint,
  });
  return Object.freeze({ status: 'identified', identity });
};

const timeoutAfter = (activeStateDeadline: number): Promise<ProcessIdentityInspectionResult> =>
  new Promise((resolve) => {
    const remaining = Math.max(0, activeStateDeadline - Date.now());
    const timer = setTimeout(() => resolve(failedInspection('deadline')), remaining);
    timer.unref();
  });

const copyEnvironment = (environment: Readonly<Record<string, string>>): Record<string, string> => {
  const entries = Object.entries(environment);
  if (entries.some(([, value]) => typeof value !== 'string'))
    throw new Error('Process environment values must be strings.');

  return Object.fromEntries(entries);
};

const clearEnvironment = (environment: Record<string, string>): void => {
  for (const key of Object.keys(environment)) delete environment[key];
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

const awaitClose = (child: ChildProcessWithoutNullStreams): Promise<ProcessExitObservation> =>
  new Promise((resolve) => {
    child.once('close', (exitCode: number | null, signal: NodeJS.Signals | null) =>
      resolve(Object.freeze({ exitCode, signal })),
    );
  });

const terminateAndReap = (
  processGroupId: number,
  completion: Promise<ProcessExitObservation>,
): Promise<void> =>
  terminateProcessGroupAndReap(processGroupId, completion, {
    terminationGraceMs,
    postKillReapTimeoutMs,
    terminationPollMs,
  });

const toBytes = (chunk: unknown): Uint8Array => {
  if (typeof chunk === 'string') return Buffer.from(chunk);
  if (chunk instanceof Uint8Array) return new Uint8Array(chunk);
  if (ArrayBuffer.isView(chunk))
    return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  throw new Error('Process stream produced a non-byte chunk.');
};

const pumpStdout = async (
  stream: Readable,
  evidence: ProcessOutputSink,
  protocol: ProcessOutputSink,
  cleanup: () => Promise<void>,
): Promise<void> => {
  try {
    for await (const chunk of stream) {
      const bytes = toBytes(chunk);
      await evidence.write(bytes);
      await protocol.write(bytes);
    }
    await evidence.end();
    await protocol.end();
  } catch {
    await cleanup();
  }
};

const pumpStderr = async (
  stream: Readable,
  evidence: ProcessOutputSink,
  cleanup: () => Promise<void>,
): Promise<void> => {
  try {
    for await (const chunk of stream) await evidence.write(toBytes(chunk));
    await evidence.end();
  } catch {
    await cleanup();
  }
};

const wrapStdin = (stdin: ChildProcessWithoutNullStreams['stdin']): ProcessInputSink => {
  let closed = false;
  const rejectIfClosed = (): Promise<never> =>
    Promise.reject(new Error('Process stdin is closed.'));

  return Object.freeze({
    write: (chunk: Uint8Array): Promise<void> => {
      if (closed) return rejectIfClosed();
      return new Promise((resolve, reject) => {
        stdin.write(chunk, (error: Error | null | undefined) => {
          if (error === null || error === undefined) resolve();
          else reject(error);
        });
      });
    },
    end: (): Promise<void> => {
      if (closed) return Promise.resolve();
      closed = true;
      return new Promise((resolve, reject) => {
        stdin.end((error?: Error | null) => {
          if (error === null || error === undefined) resolve();
          else reject(error);
        });
      });
    },
    abort: (): Promise<void> => {
      if (closed) return Promise.resolve();
      closed = true;
      stdin.destroy();
      return Promise.resolve();
    },
  });
};

export class NodePosixProcessSpawnDispatch {
  beginStart(attempt: ProcessStartAttempt, request: ProcessSpawnRequest): void {
    beginProcessStart(attempt, () => {
      this.dispatch(attempt, request);
    });
  }

  handle(attempt: ProcessStartAttempt): NodePosixProcessSpawnHandle | undefined {
    return PROCESS_SPAWN_HANDLES.get(attempt);
  }

  async killUnactivated(process: SpawnAcceptedProcess): Promise<void> {
    const handle = PROCESS_SPAWN_HANDLES.get(process);
    const processGroupId = handle?.child.pid;
    ACTIVATED.add(process);
    if (handle === undefined || processGroupId === undefined) return;
    await terminateAndReap(processGroupId, handle.completion);
    settleProcessStartQuiescence(handle.attempt, {
      status: 'quiescent',
      disposition: 'cleanup_confirmed',
    });
  }

  async inspectIdentity(
    process: SpawnAcceptedProcess,
    activeStateDeadline: number,
  ): Promise<ProcessIdentityInspectionResult> {
    const handle = PROCESS_SPAWN_HANDLES.get(process);
    const pid = handle?.child.pid;
    if (pid === undefined || !Number.isSafeInteger(pid) || pid < 1)
      return failedInspection('inspection_failed');

    return Promise.race([inspectLinuxProcess(pid), timeoutAfter(activeStateDeadline)]);
  }

  activateIo(
    process: SpawnAcceptedProcess,
    io: PausedProcessIo,
    identity: ProcessIdentity,
    coordinator: DuplexCoordinatorRegistration,
    options: {
      readonly secretValues: readonly string[];
      readonly maxStdoutBytes: number;
      readonly maxStderrBytes: number;
      readonly protocolObserverSink?: ProcessOutputSink;
    },
  ): ProcessIoActivationResult {
    const handle = PROCESS_SPAWN_HANDLES.get(process);
    const token = handle === undefined ? undefined : getProcessStartInvocationToken(handle.attempt);
    if (
      handle === undefined ||
      token === undefined ||
      ACTIVATED.has(process) ||
      !SpawnAcceptedProcess.isBoundToToken(process, token) ||
      !PausedProcessIo.isBoundToToken(io, token) ||
      !DuplexCoordinatorRegistration.isBoundToToken(coordinator, token) ||
      identity.pid !== handle.child.pid ||
      identity.processGroupId !== handle.child.pid
    )
      return rejectedActivation();

    let stdin: ProcessInputSink;
    let evidenceStdout: ProcessOutputSink;
    let protocolStdout: ProcessOutputSink;
    let evidenceStderr: ProcessOutputSink;
    try {
      stdin = wrapStdin(handle.child.stdin);
      evidenceStdout = createRedactingBoundedOutputSink({
        downstream: handle.evidenceStdout,
        secretValues: options.secretValues,
        maxBytes: options.maxStdoutBytes,
      });
      protocolStdout = createRedactingBoundedOutputSink({
        downstream: options.protocolObserverSink ?? noopOutputSink,
        secretValues: options.secretValues,
        maxBytes: options.maxStdoutBytes,
      });
      evidenceStderr = createRedactingBoundedOutputSink({
        downstream: handle.evidenceStderr,
        secretValues: options.secretValues,
        maxBytes: options.maxStderrBytes,
      });
    } catch {
      return rejectedActivation();
    }

    ACTIVATED.add(process);
    let cleanup: Promise<void> | undefined;
    const cleanupProcess = (): Promise<void> => {
      cleanup ??= terminateAndReap(identity.processGroupId, handle.completion);
      return cleanup;
    };
    const stdoutPump = pumpStdout(
      handle.stdout,
      evidenceStdout,
      protocolStdout,
      cleanupProcess,
    ).catch(() => undefined);
    const stderrPump = pumpStderr(handle.stderr, evidenceStderr, cleanupProcess).catch(
      () => undefined,
    );
    const completion = Promise.allSettled([handle.completion, stdoutPump, stderrPump]).then(
      async () => handle.completion,
    );

    const liveOwnedProcess: LiveOwnedProcess = Object.freeze({
      spawnedAt: handle.spawnedAt,
      identity,
      completion,
      stdin,
      terminateAndReap: cleanupProcess,
    });
    settleProcessStartQuiescence(handle.attempt, {
      status: 'quiescent',
      disposition: 'transferred_to_coordinator',
    });
    return Object.freeze({ status: 'activated', process: liveOwnedProcess });
  }

  private dispatch(attempt: ProcessStartAttempt, request: ProcessSpawnRequest): void {
    let environment: Record<string, string>;
    try {
      assertOutputSink(request.stdout, 'stdout');
      assertOutputSink(request.stderr, 'stderr');
      environment = copyEnvironment(request.environment);
    } catch {
      settleProcessStart(attempt, { status: 'failed' });
      return;
    }

    const args = [...request.args];
    const child = spawn(request.executable, args, {
      cwd: request.cwd,
      detached: true,
      env: environment,
      shell: request.shell,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    args.length = 0;
    clearEnvironment(environment);

    child.once('spawn', () => {
      const spawnedAt = Date.now();
      const completion = awaitClose(child);
      const handle = Object.freeze({
        child,
        stdout: child.stdout,
        stderr: child.stderr,
        evidenceStdout: request.stdout,
        evidenceStderr: request.stderr,
        spawnedAt,
        attempt,
        completion,
      });
      PROCESS_SPAWN_HANDLES.set(attempt, handle);
      const settled = settleProcessStart(attempt, { status: 'accepted', spawnedAt });
      if (settled?.status === 'spawn_accepted') PROCESS_SPAWN_HANDLES.set(settled.process, handle);
    });
    child.once('error', () => {
      settleProcessStart(attempt, { status: 'failed' });
    });
  }
}
