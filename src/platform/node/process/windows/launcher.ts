import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { Readable, Writable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';

import { execa } from 'execa';

import {
  ProcessStartError,
  type OwnedProcess,
  type ProcessCleanupOutcome,
  type ProcessExit,
  type ProcessLaunch,
} from '../../../../execution/process/port.js';
import type { ProcessIdentityInspector } from '../identity.js';
import { windowsProcessNative } from './bindings.js';
import { createWindowsProcessOperations } from './operations.js';
import { waitForWindowsJob } from './wait.js';

const bootstrapUrl = new URL('./bootstrap.js', import.meta.url);
// Source tests use Node's native type stripping; the published package always has .js.
const bootstrapModule = existsSync(bootstrapUrl)
  ? bootstrapUrl.href
  : new URL('./bootstrap.ts', import.meta.url).href;
const windowsOperations = createWindowsProcessOperations(windowsProcessNative);

export const launchWindowsProcess = async (
  launch: ProcessLaunch,
  signal: AbortSignal,
  inspectIdentity?: ProcessIdentityInspector,
): Promise<OwnedProcess> => {
  if (signal.aborted) throw new Error('Owned process start was cancelled.');
  const jobName = `revo-${randomUUID()}`;
  const job = windowsOperations.createWindowsJob(jobName);
  const child = execa(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { runWindowsBootstrap } from ${JSON.stringify(bootstrapModule)}; await runWindowsBootstrap();`,
    ],
    {
      env: {},
      extendEnv: false,
      stdio: 'pipe',
      ipc: true,
      buffer: false,
      reject: false,
    },
  );
  const pid = child.pid;
  if (pid === undefined) {
    job.close();
    throw await child;
  }
  let providerExit: ProcessExit | undefined;
  let reap!: (exit: ProcessExit) => void;
  const completion = new Promise<ProcessExit>((resolve) => {
    reap = resolve;
  });
  let assigned = false;
  let cleanupPromise: Promise<ProcessCleanupOutcome> | undefined;
  const terminateAndReap = (): Promise<ProcessCleanupOutcome> => {
    cleanupPromise ??= (async () => {
      try {
        if (assigned) job.terminate();
        else child.kill('SIGKILL');
        const empty = await waitForWindowsJob(job, Date.now() + 2_500);
        const exit = await Promise.race([completion, delay(500).then(() => undefined)]);
        return empty && exit !== undefined
          ? { status: 'confirmed', exit }
          : { status: 'uncertain' };
      } finally {
        job.close();
      }
    })();
    return cleanupPromise;
  };
  let opened = false;
  let accept!: () => void;
  let reject!: (error: unknown) => void;
  const admission = new Promise<void>((resolve, rejectPromise) => {
    accept = resolve;
    reject = rejectPromise;
  });
  void admission.catch(() => undefined); // Observation while native admission is still executing.
  // Reap from the OS exit event: inherited provider pipes must not delay Job cleanup.
  child.nodeChildProcess.once('exit', (exitCode, exitSignal) => {
    reap(providerExit ?? { exitCode, signal: exitSignal });
    if (!opened) reject(new Error('Process bootstrap exited before provider admission.'));
    void terminateAndReap().catch(reject);
  });
  child.nodeChildProcess.once('error', reject);
  child.nodeChildProcess.on(
    'message',
    (message: {
      type: string;
      exitCode?: number | null;
      signal?: string | null;
      message?: string;
      code?: string;
    }) => {
      if (message.type === 'spawned') {
        opened = true;
        accept();
      } else if (message.type === 'failed')
        reject(
          Object.assign(new Error(message.message ?? 'Provider spawn failed.'), {
            code: message.code,
          }),
        );
      else if (message.type === 'exit') {
        providerExit = { exitCode: message.exitCode ?? null, signal: message.signal ?? null };
        void terminateAndReap().catch(reject);
      }
    },
  );
  // Execa's promise drains inherited streams; observe it but never use it to initiate cleanup.
  void child.catch(reject);
  child.stdout.on('data', (chunk: Uint8Array) => launch.onStdout?.(new Uint8Array(chunk)));
  child.stderr.on('data', (chunk: Uint8Array) => launch.onStderr?.(new Uint8Array(chunk)));
  child.stderr.resume();
  const aborted = () => reject(signal.reason);
  signal.addEventListener('abort', aborted, { once: true });
  const timeout = setTimeout(
    () => reject(new Error('Process bootstrap admission timed out.')),
    10_000,
  );
  try {
    const identity = windowsOperations.inspectWindowsIdentity(pid, jobName);
    job.assign(pid);
    assigned = true;
    if (inspectIdentity) await Promise.race([inspectIdentity(pid), admission]);
    if (signal.aborted) throw signal.reason;
    child.nodeChildProcess.send?.(
      {
        command: launch.command,
        args: launch.args,
        cwd: launch.cwd,
        environment: launch.environment,
      },
      (error) => {
        if (error) reject(error);
      },
    );
    await admission;
    return Object.freeze({
      identity,
      completion,
      terminateAndReap,
      transport: Object.freeze({
        input: Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
        output: Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
      }),
    });
  } catch (cause) {
    const cleanup = await terminateAndReap();
    throw new ProcessStartError(cleanup.status, { cause });
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', aborted);
  }
};
