import { spawn } from 'node:child_process';
import { access, constants, stat } from 'node:fs/promises';
import { delimiter, isAbsolute, resolve as resolvePath } from 'node:path';

import type {
  BoundedCommandObservation,
  BoundedCommandPort,
  BoundedCommandRequest,
  CommandResolution,
  ProcessCleanupAttemptOutcome,
  RunningBoundedCommand,
} from '../../runtime/execution/index.js';
import { NODE_POSIX_PROCESS_TERMINATION_TIMEOUTS } from './node-posix-process-termination-timeouts.js';
import { terminateProcessGroupAndReap } from './posix-process-group-termination.js';

const positiveBound = (value: number | undefined, fallback: number): number => {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1)
    throw new Error('Command limits must be positive safe integers.');
  return result;
};

const overflowStatus = (overflow: { stdout: boolean; stderr: boolean }) => {
  if (overflow.stdout && overflow.stderr) return 'both' as const;
  if (overflow.stdout) return 'stdout' as const;
  if (overflow.stderr) return 'stderr' as const;
  return 'none' as const;
};

const executableCandidate = async (candidate: string): Promise<boolean> => {
  try {
    const metadata = await stat(candidate);
    await access(candidate, constants.X_OK);
    return metadata.isFile();
  } catch {
    return false;
  }
};

const resolveCommand = async (
  command: string,
  environment: Readonly<Record<string, string>>,
  cwd: string | undefined,
): Promise<CommandResolution> => {
  if (command.length === 0 || command.includes('\u0000'))
    return { status: 'unavailable', reason: 'not_found' };
  if (isAbsolute(command))
    return (await executableCandidate(command))
      ? { status: 'resolved', executable: command }
      : { status: 'unavailable', reason: 'not_launchable' };
  const path = environment.PATH ?? process.env.PATH ?? '';
  const baseDirectory = cwd ?? process.cwd();
  const candidates = path
    .split(delimiter)
    .map((directory) =>
      resolvePath(baseDirectory, directory.length === 0 ? '.' : directory, command),
    );
  const results = await Promise.all(
    candidates.map(async (candidate) => ({
      candidate,
      executable: await executableCandidate(candidate),
    })),
  );
  const match = results.find((result) => result.executable);
  if (match !== undefined) return { status: 'resolved', executable: match.candidate };
  return { status: 'unavailable', reason: 'not_found' };
};

export class NodePosixBoundedCommandPort implements BoundedCommandPort {
  async resolve(request: BoundedCommandRequest): Promise<CommandResolution> {
    return resolveCommand(request.command, request.environment, request.cwd);
  }

  async start(request: BoundedCommandRequest): Promise<RunningBoundedCommand> {
    const stdoutLimit = positiveBound(request.maxStdoutBytes, 65_536);
    const stderrLimit = positiveBound(request.maxStderrBytes, 65_536);
    const timeoutMs = positiveBound(request.timeoutMs, 5_000);
    const child = spawn(request.command, [...request.args], {
      cwd: request.cwd,
      detached: true,
      env: { ...request.environment },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const output = {
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
      overflow: { stdout: false, stderr: false },
    };
    const collect = (
      stream: NodeJS.ReadableStream | null,
      key: 'stdout' | 'stderr',
      limit: number,
    ): Promise<void> =>
      new Promise((resolve, reject) => {
        if (stream === null) return resolve();
        stream.on('data', (chunk: Buffer | Uint8Array | string) => {
          const bytes = Buffer.from(chunk);
          const next = Buffer.concat([output[key], bytes]);
          if (next.byteLength > limit) {
            output.overflow[key] = true;
            output[key] = next.subarray(0, limit);
          } else output[key] = next;
        });
        stream.once('end', () => resolve());
        stream.once('error', reject);
      });
    const completion = new Promise<BoundedCommandObservation>((resolve, reject) => {
      let settled = false;
      const settle = (observation: BoundedCommandObservation): void => {
        if (settled) return;
        settled = true;
        resolve(observation);
      };
      const streams = Promise.all([
        collect(child.stdout, 'stdout', stdoutLimit),
        collect(child.stderr, 'stderr', stderrLimit),
      ]);
      child.once('error', () => settle({ status: 'spawn_failed' }));
      child.once('close', (exitCode, signal) => {
        void streams.then(() => {
          settle(
            Object.freeze({
              status: 'exited',
              exitCode,
              signal,
              stdout: new Uint8Array(output.stdout),
              stderr: new Uint8Array(output.stderr),
              overflow: overflowStatus(output.overflow),
            }),
          );
        }, reject);
      });
    });
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timeoutId = setTimeout(resolve, timeoutMs);
    });
    const clearCommandTimeout = (): void => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    };
    void completion.then(clearCommandTimeout, clearCommandTimeout);
    const pid = child.pid;
    let cleanup: Promise<ProcessCleanupAttemptOutcome | undefined> | undefined;
    const terminateAndReap = (): Promise<ProcessCleanupAttemptOutcome | undefined> => {
      cleanup ??=
        pid === undefined || !Number.isSafeInteger(pid) || pid < 1
          ? completion.then(
              () => undefined,
              () => undefined,
            )
          : terminateProcessGroupAndReap(pid, completion, {
              ...NODE_POSIX_PROCESS_TERMINATION_TIMEOUTS,
            });
      return cleanup;
    };
    return Object.freeze({ completion, timeout, terminateAndReap });
  }
}
