import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { PassThrough } from 'node:stream';

import which from 'which';

import type {
  ExecutableProbePort,
  ExecutableResolution,
  RunningVersionProbe,
  VersionProbeObservation,
  VersionProbeOverflow,
} from '../../../execution/probe/port.js';
import { ProcessStartError, type ProcessLauncher } from '../../../process/index.js';
import { nodeProcessLauncher } from '../../../process/node.js';
import { nodeErrorCode } from '../../../process/resources.js';

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

type VersionProbeRequest = Parameters<ExecutableProbePort['startVersionProbe']>[0];

const startVersionProbe = async (
  request: VersionProbeRequest,
  spawner: ProcessLauncher,
): Promise<RunningVersionProbe> => {
  const stdoutStream = new PassThrough();
  const stderrStream = new PassThrough();
  const stdout = collectBounded(stdoutStream, request.stdoutLimitBytes);
  const stderr = collectBounded(stderrStream, request.stderrLimitBytes);
  const controller = new AbortController();
  const launched = spawner.start(
    {
      command: request.executable,
      args: request.args,
      cwd: process.cwd(),
      environment: request.environment,
      onStdout: (bytes) => {
        stdoutStream.write(bytes);
      },
      onStderr: (bytes) => {
        stderrStream.write(bytes);
      },
    },
    controller.signal,
  );
  const completion: Promise<VersionProbeObservation> = launched.then(
    async (owned) => {
      void owned.transport.input.close().catch(() => undefined);
      // Output callbacks retain bounded evidence; drain the protocol stream without a second buffer.
      void owned.transport.output.pipeTo(new WritableStream()).catch(() => undefined);
      const exit = await owned.completion;
      // Exit and pipe closure are separate OS events. Retain output through cleanup.
      await owned.terminateAndReap();
      stdoutStream.end();
      stderrStream.end();
      await Promise.all([stdout.completion, stderr.completion]);
      return Object.freeze({
        ...exit,
        overflow: overflowFor(stdout.overflowed(), stderr.overflowed()),
        status: 'exited' as const,
        stderr: stderr.bytes(),
        stdout: stdout.bytes(),
      });
    },
    () => {
      stdoutStream.end();
      stderrStream.end();
      return { status: 'spawn_failed' };
    },
  );
  let timeoutId!: ReturnType<typeof setTimeout>;
  const timeout = new Promise<void>((resolve) => {
    timeoutId = setTimeout(resolve, request.timeoutMs);
  });
  void completion.then(
    () => clearTimeout(timeoutId),
    () => clearTimeout(timeoutId),
  );
  let cleanup: Promise<void> | undefined;
  const terminateAndReap = (): Promise<void> => {
    cleanup ??= (async () => {
      controller.abort();
      const owned = await launched.catch((error: unknown) => {
        if (error instanceof ProcessStartError && error.cleanup === 'uncertain')
          throw new Error('Version probe cleanup is uncertain.', { cause: error });
        return undefined;
      });
      if (owned === undefined) return;
      const outcome = await owned.terminateAndReap();
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

export const createNodeExecutableProbe = (spawner: ProcessLauncher): ExecutableProbePort =>
  Object.freeze({
    hostPlatform: () => normalizeHostPlatform(process.platform),
    resolveExecutable,
    startVersionProbe: (request: VersionProbeRequest) => startVersionProbe(request, spawner),
  });

export const nodeExecutableProbe = createNodeExecutableProbe(nodeProcessLauncher);
