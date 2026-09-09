import { Readable, Writable } from 'node:stream';

import { execa } from 'execa';

import type {
  OwnedProcess,
  ProcessExit,
  ProcessIdentityInspector,
  ProcessLaunch,
  ProcessRun,
} from '../contracts.js';
import { createProcessCleanup } from './cleanup.js';
import { rejectProcessStart } from './start-error.js';

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
  if (pid === undefined) throw await child;
  const readExit = (): ProcessExit => ({
    exitCode: child.nodeChildProcess.exitCode,
    signal: child.nodeChildProcess.signalCode,
  });
  // Process exit drives supervision; inherited streams may still be open then.
  const completion = new Promise<ProcessExit>((resolve) => {
    child.nodeChildProcess.once('exit', () => resolve(readExit()));
  });
  const closed = new Promise<ProcessExit>((resolve) => {
    child.nodeChildProcess.once('close', () => resolve(readExit()));
  });
  void child.catch(() => undefined);
  child.stdout.on('data', (chunk: Uint8Array) => launch.onStdout?.(new Uint8Array(chunk)));
  child.stderr.on('data', (chunk: Uint8Array) => launch.onStderr?.(new Uint8Array(chunk)));
  child.stderr.resume();
  // Cleanup confirms both the process group and closure of its local pipes.
  const terminateAndReap = createProcessCleanup(pid, closed);
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
      return rejectProcessStart(cause, () => process.terminateAndReap());
    }
  },
});
