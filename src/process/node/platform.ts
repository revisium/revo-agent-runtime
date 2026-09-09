import type {
  OwnedProcess,
  ProcessIdentityInspector,
  ProcessLaunch,
  ProcessRun,
  RecoveredProcessInspector,
} from '../contracts.js';
import { inspectLinuxProcessIdentity } from './linux.js';
import { createPosixRecovery } from './posix-recovery.js';
import { createPosixProcesses } from './posix.js';

interface ProcessPlatform {
  readonly name: string;
  launch(launch: ProcessLaunch, signal: AbortSignal): Promise<ProcessRun>;
  spawn(
    launch: ProcessLaunch,
    signal: AbortSignal,
    inspect?: ProcessIdentityInspector,
  ): Promise<OwnedProcess>;
  readonly recover: RecoveredProcessInspector;
}

const createPlatform = async (): Promise<ProcessPlatform> => {
  if (process.platform === 'win32') {
    const { launchWindowsProcess } = await import('./windows/launcher.js');
    const { windowsRecovery } = await import('./windows/recovery.js');
    return {
      name: 'win32',
      launch: launchWindowsProcess,
      spawn: launchWindowsProcess,
      recover: windowsRecovery,
    };
  }
  if (process.platform !== 'linux' && process.platform !== 'darwin')
    throw new Error(`Unsupported process platform: ${process.platform}`);
  const inspect =
    process.platform === 'linux'
      ? inspectLinuxProcessIdentity
      : (await import('./darwin.js')).inspectDarwinProcessIdentity;
  return {
    name: process.platform,
    ...createPosixProcesses(inspect),
    recover: createPosixRecovery(inspect),
  };
};

let selected: Promise<ProcessPlatform> | undefined;
export const processPlatform = (): Promise<ProcessPlatform> => (selected ??= createPlatform());
