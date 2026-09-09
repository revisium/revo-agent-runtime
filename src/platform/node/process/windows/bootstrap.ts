import { spawn } from 'node:child_process';
import { once } from 'node:events';

import type { ProcessLaunch } from '../../../../execution/process/port.js';

/** Trusted startup: no provider environment or code is loaded until the owner assigns the Job. */
export const runWindowsBootstrap = async (): Promise<void> => {
  const launch = await new Promise<ProcessLaunch>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Process owner did not admit the launch.')),
      10_000,
    );
    process.once('message', (message: ProcessLaunch) => {
      clearTimeout(timeout);
      resolve(message);
    });
    process.once('disconnect', () => {
      clearTimeout(timeout);
      process.exit(1);
    });
  });
  // Discovery already resolves the executable and Node entrypoint. Node's literal
  // spawn preserves ENOENT; Execa may launch cmd.exe for a missing Windows command.
  const child = spawn(launch.command, [...launch.args], {
    cwd: launch.cwd,
    env: launch.environment ?? {},
    stdio: 'inherit',
    shell: false,
  });
  child.once('spawn', () => process.send?.({ type: 'spawned' }));
  try {
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
