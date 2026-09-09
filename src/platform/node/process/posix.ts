import { Readable, Writable } from 'node:stream';

import { execa } from 'execa';

import type {
  OwnedProcess,
  ProcessExit,
  ProcessLaunch,
  ProcessRun,
} from '../../../execution/process/port.js';
import { ProcessStartError } from '../../../execution/process/port.js';
import { createProcessCleanup } from './cleanup.js';
import type { ProcessIdentityInspector } from './identity.js';

const launchPosix = async (
  launch: ProcessLaunch,
  signal: AbortSignal,
): Promise<ProcessRun & { readonly pid: number }> => {
  if (signal.aborted) throw new Error('Owned process start was cancelled.');
  const child = execa(launch.command, [...launch.args], {
    buffer: false,
    cwd: launch.cwd,
    detached: true,
    env: launch.environment ?? {},
    extendEnv: false,
    shell: false,
    stdio: 'pipe',
  });
  const pid = child.pid;
  if (pid === undefined) {
    await child;
    throw new Error('Owned process did not expose required process resources.');
  }
  const readExit = (): ProcessExit => ({
    exitCode: child.nodeChildProcess.exitCode,
    signal: child.nodeChildProcess.signalCode,
  });
  const completion = child.then(readExit, readExit);
  child.stdout.on('data', (chunk: Uint8Array) => launch.onStdout?.(new Uint8Array(chunk)));
  child.stderr.on('data', (chunk: Uint8Array) => launch.onStderr?.(new Uint8Array(chunk)));
  child.stderr.resume();
  const terminateAndReap = createProcessCleanup(pid, completion);
  if (signal.aborted) {
    const cleanup = await terminateAndReap();
    throw new ProcessStartError(cleanup.status, { cause: signal.reason });
  }
  return Object.freeze({
    pid,
    completion,
    terminateAndReap,
    transport: Object.freeze({
      input: Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      output: Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    }),
  });
};

export const createPosixProcesses = (inspect: ProcessIdentityInspector) => ({
  launch: launchPosix,
  async spawn(
    launch: ProcessLaunch,
    signal: AbortSignal,
    inspectIdentity = inspect,
  ): Promise<OwnedProcess> {
    const process = await launchPosix(launch, signal);
    try {
      const identity = await inspectIdentity(process.pid);
      if (signal.aborted) throw signal.reason;
      return Object.freeze({
        completion: process.completion,
        identity,
        transport: process.transport,
        terminateAndReap: process.terminateAndReap,
      });
    } catch (cause) {
      const cleanup = await process.terminateAndReap();
      throw new ProcessStartError(cleanup.status, { cause });
    }
  },
});
