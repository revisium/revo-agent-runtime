import { once } from 'node:events';
import { access } from 'node:fs/promises';

import { execa } from 'execa';

import type { ProcessLaunch } from '../../contracts.js';

/** Trusted startup: no provider environment or code is loaded until the owner assigns the Job. */
export const runWindowsBootstrap = async (): Promise<void> => {
  console.error('BOOT loaded', Date.now());
  const launch = await new Promise<ProcessLaunch>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Process owner did not admit the launch.')),
      10_000,
    );
    process.once('message', (message: ProcessLaunch) => {
      console.error('BOOT received', Date.now());
      clearTimeout(timeout);
      resolve(message);
    });
    process.once('disconnect', () => {
      clearTimeout(timeout);
      process.exit(1);
    });
  });
  try {
    console.error('BOOT launching', launch.command, Date.now());
    // Preflight supplies a resolved path. Reject missing files before Execa can
    // fall back to cmd.exe; retain its Windows shebang and argument handling.
    await access(launch.command);
    const subprocess = execa(launch.command, [...launch.args], {
      cwd: launch.cwd,
      env: launch.environment ?? {},
      extendEnv: false,
      stdio: 'inherit',
      shell: false,
      reject: false,
    });
    void subprocess.catch(() => undefined);
    const child = subprocess.nodeChildProcess;
    child.once('spawn', () => { console.error('BOOT spawned', Date.now()); process.send?.({ type: 'spawned' }); });
    await once(child, 'exit');
    process.send?.({
      type: 'exit',
      exitCode: child.exitCode,
      signal: child.signalCode,
    });
  } catch (error) {
    process.send?.({
      type: 'failed',
      message: error instanceof Error ? error.message : 'Provider spawn failed.',
      code: error instanceof Error && 'code' in error ? error.code : undefined,
    });
  }
  process.disconnect?.();
};
