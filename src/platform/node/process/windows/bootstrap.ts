import { execa } from 'execa';

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
  const child = execa(launch.command, [...launch.args], {
    cwd: launch.cwd,
    env: launch.environment ?? {},
    extendEnv: false,
    stdio: 'inherit',
    shell: false,
    reject: false,
  });
  child.nodeChildProcess.once('spawn', () => process.send?.({ type: 'spawned' }));
  const result = await child;
  if (result.failed && result.code !== undefined) {
    process.send?.({
      type: 'failed',
      message: result.originalMessage,
      code: result.cause instanceof Error && 'code' in result.cause ? result.cause.code : undefined,
    });
  } else {
    process.send?.({
      type: 'exit',
      exitCode: result.exitCode ?? null,
      signal: result.signal ?? null,
    });
  }
  process.exitCode = result.failed ? result.exitCode || 1 : 0;
  process.disconnect?.();
};
