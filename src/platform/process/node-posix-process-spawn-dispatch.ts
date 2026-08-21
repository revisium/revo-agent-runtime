import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readlink, stat } from 'node:fs/promises';

import canonicalize from 'canonicalize';

import {
  beginProcessStart,
  settleProcessStart,
  type ProcessIdentity,
  type ProcessIdentityInspectionResult,
  type ProcessOutputSink,
  type ProcessSpawnRequest,
  type ProcessStartAttempt,
  type SpawnAcceptedProcess,
} from '../../runtime/execution/index.js';

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
  readonly stdout: ProcessOutputSink;
  readonly stderr: ProcessOutputSink;
}

const PROCESS_SPAWN_HANDLES = new WeakMap<object, NodePosixProcessSpawnHandle>();

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

export class NodePosixProcessSpawnDispatch {
  beginStart(attempt: ProcessStartAttempt, request: ProcessSpawnRequest): void {
    beginProcessStart(attempt, () => {
      this.dispatch(attempt, request);
    });
  }

  handle(attempt: ProcessStartAttempt): NodePosixProcessSpawnHandle | undefined {
    return PROCESS_SPAWN_HANDLES.get(attempt);
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
      const handle = Object.freeze({
        child,
        stdout: request.stdout,
        stderr: request.stderr,
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
