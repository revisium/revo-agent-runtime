import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

import { execa } from 'execa';
import which from 'which';

import type {
  ExecutableProbePort,
  ExecutableResolution,
  RunningVersionProbe,
  VersionProbeObservation,
  VersionProbeOverflow,
} from '../../../execution/probe/port.js';
import type { ProcessExit } from '../../../execution/process/port.js';
import { createProcessCleanup } from '../process/cleanup.js';
import { nodeErrorCode } from '../process/errors.js';

export interface BoundedStream {
  readonly bytes: () => Uint8Array;
  readonly overflowed: () => boolean;
  readonly completion: Promise<void>;
}

export const collectBounded = (
  stream: NodeJS.ReadableStream | null,
  limit: number,
): BoundedStream => {
  const chunks: Uint8Array[] = [];
  let retained = 0;
  let overflowed = false;
  const completion = new Promise<void>((resolve, reject) => {
    if (stream === null) {
      resolve();
      return;
    }
    stream.on('data', (chunk: Uint8Array | string) => {
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : new Uint8Array(chunk);
      const available = Math.max(0, limit - retained);
      if (bytes.byteLength > available) overflowed = true;
      if (available > 0) {
        const kept = bytes.subarray(0, available);
        chunks.push(kept);
        retained += kept.byteLength;
      }
    });
    stream.once('end', resolve);
    stream.once('error', reject);
  });
  return Object.freeze({
    bytes: () =>
      new Uint8Array(
        Buffer.concat(
          chunks.map((chunk) => Buffer.from(chunk)),
          retained,
        ),
      ),
    completion,
    overflowed: () => overflowed,
  });
};

const overflowFor = (stdout: boolean, stderr: boolean): VersionProbeOverflow => {
  if (stdout && stderr) return 'both';
  if (stdout) return 'stdout';
  if (stderr) return 'stderr';
  return 'none';
};

const executableCandidate = async (
  candidate: string,
): Promise<'launchable' | 'missing' | 'not_launchable'> => {
  try {
    const metadata = await stat(candidate);
    await access(candidate, constants.R_OK | constants.X_OK);
    return metadata.isFile() ? 'launchable' : 'not_launchable';
  } catch (error) {
    return nodeErrorCode(error) === 'ENOENT' ? 'missing' : 'not_launchable';
  }
};

const resolveExecutable = async (command: string): Promise<ExecutableResolution> => {
  if (command.length === 0 || command.includes('\0'))
    return Object.freeze({ reason: 'not_found', status: 'unavailable' });
  if (isAbsolute(command)) {
    const candidate = await executableCandidate(command);
    return candidate === 'launchable'
      ? Object.freeze({ executable: command, status: 'resolved' })
      : Object.freeze({
          reason: candidate === 'missing' ? 'not_found' : 'not_launchable',
          status: 'unavailable',
        });
  }
  const found = await which(command, { nothrow: true });
  if (found === null) return Object.freeze({ reason: 'not_found', status: 'unavailable' });
  return Object.freeze({ executable: found, status: 'resolved' });
};

const processExit = (value: {
  readonly exitCode?: number;
  readonly signal?: string;
}): ProcessExit =>
  Object.freeze({ exitCode: value.exitCode ?? null, signal: value.signal ?? null });

type ProcessCleanupFactory = typeof createProcessCleanup;
type VersionProbeRequest = Parameters<ExecutableProbePort['startVersionProbe']>[0];

const startVersionProbe = async (
  request: VersionProbeRequest,
  cleanupProcess: ProcessCleanupFactory,
): Promise<RunningVersionProbe> => {
  const child = execa(request.executable, [...request.args], {
    buffer: false,
    detached: true,
    env: { ...request.environment },
    extendEnv: false,
    reject: false,
    shell: request.shell,
    stdin: 'ignore',
    stderr: 'pipe',
    stdout: 'pipe',
    windowsHide: true,
  });
  const stdout = collectBounded(child.stdout, request.stdoutLimitBytes);
  const stderr = collectBounded(child.stderr, request.stderrLimitBytes);
  const exit: Promise<ProcessExit> = child.then(processExit, processExit);
  const completion: Promise<VersionProbeObservation> = child.then(async (result) => {
    await Promise.all([stdout.completion, stderr.completion]);
    if (child.pid === undefined) return Object.freeze({ status: 'spawn_failed' as const });
    return Object.freeze({
      exitCode: result.exitCode ?? null,
      overflow: overflowFor(stdout.overflowed(), stderr.overflowed()),
      signal: result.signal ?? null,
      status: 'exited' as const,
      stderr: stderr.bytes(),
      stdout: stdout.bytes(),
    });
  });
  let timeoutId!: ReturnType<typeof setTimeout>;
  const timeout = new Promise<void>((resolve) => {
    timeoutId = setTimeout(resolve, request.timeoutMs);
  });
  void completion.finally(() => {
    clearTimeout(timeoutId);
  });
  const pid = child.pid;
  let cleanup: Promise<void> | undefined;
  const terminateAndReap = (): Promise<void> => {
    cleanup ??= (async () => {
      if (pid === undefined) {
        await completion;
        return;
      }
      const outcome = await cleanupProcess(pid, exit)();
      if (outcome.status !== 'confirmed') throw new Error('Version probe cleanup is uncertain.');
    })();
    return cleanup;
  };
  return Object.freeze({ completion, terminateAndReap, timeout } satisfies RunningVersionProbe);
};

export const normalizeHostPlatform = (
  platform: NodeJS.Platform,
): ReturnType<ExecutableProbePort['hostPlatform']> => {
  if (platform === 'darwin' || platform === 'linux' || platform === 'win32') return platform;
  return 'other';
};

export const nodeExecutableProbe: ExecutableProbePort = Object.freeze({
  hostPlatform: () => normalizeHostPlatform(process.platform),
  resolveExecutable,
  startVersionProbe: (request: VersionProbeRequest) =>
    startVersionProbe(request, createProcessCleanup),
});

export const createNodeExecutableProbe = (
  cleanupProcess: ProcessCleanupFactory,
): ExecutableProbePort =>
  Object.freeze({
    hostPlatform: () => normalizeHostPlatform(process.platform),
    resolveExecutable,
    startVersionProbe: (request: VersionProbeRequest) => startVersionProbe(request, cleanupProcess),
  });
