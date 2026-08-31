import { Readable, Writable } from 'node:stream';

import { execa } from 'execa';

import type {
  OwnedProcess,
  ProcessExit,
  ProcessIdentity,
  ProcessLaunch,
  ProcessSpawner,
} from '../../../execution/process/port.js';
import { ProcessStartError } from '../../../execution/process/port.js';
import { createProcessCleanup } from './cleanup.js';
import { inspectLinuxProcessIdentity, type ProcessIdentityInspector } from './identity.js';

const startOwnedProcess = async (
  launch: ProcessLaunch,
  signal: AbortSignal,
  inspectIdentity: ProcessIdentityInspector,
): Promise<OwnedProcess> => {
  if (signal.aborted) throw new Error('Owned process start was cancelled.');
  const child = execa(launch.command, [...launch.args], {
    buffer: false,
    cwd: launch.cwd,
    detached: true,
    env: { ...(launch.environment ?? {}) },
    extendEnv: false,
    shell: false,
    stdio: 'pipe',
  });
  const pid = child.pid;
  if (pid === undefined || child.stdin === null || child.stdout === null) {
    child.kill('SIGKILL');
    await child.catch(() => undefined);
    throw new Error('Owned process did not expose required process resources.');
  }
  const readProcessExit = (): ProcessExit =>
    Object.freeze({
      exitCode: child.nodeChildProcess.exitCode,
      signal: child.nodeChildProcess.signalCode,
    });
  const completion = child.then(readProcessExit, readProcessExit);
  child.stdout.on('data', (chunk: Uint8Array) => launch.onStdout?.(new Uint8Array(chunk)));
  child.stderr?.on('data', (chunk: Uint8Array) => launch.onStderr?.(new Uint8Array(chunk)));
  child.stderr?.resume();
  let identity: ProcessIdentity;
  try {
    identity = await inspectIdentity(pid);
  } catch {
    const cleanup = await createProcessCleanup(pid, completion)();
    throw new ProcessStartError(cleanup.status);
  }
  if (signal.aborted) {
    const cleanup = await createProcessCleanup(identity.processGroupId, completion)();
    throw new ProcessStartError(cleanup.status);
  }
  return Object.freeze({
    completion,
    identity,
    terminateAndReap: createProcessCleanup(identity.processGroupId, completion),
    transport: Object.freeze({
      input: Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      output: Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    }),
  });
};

export const createNodeProcessSpawner = (
  inspectIdentity: ProcessIdentityInspector = inspectLinuxProcessIdentity,
): ProcessSpawner =>
  Object.freeze({
    start: (launch: ProcessLaunch, signal: AbortSignal) =>
      startOwnedProcess(launch, signal, inspectIdentity),
  });

export const nodeProcessSpawner: ProcessSpawner = createNodeProcessSpawner();
