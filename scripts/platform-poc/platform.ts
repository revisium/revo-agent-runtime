import { inspectLinuxProcessIdentity } from '../../src/platform/node/process/identity.js';

export interface Identity {
  readonly pid: number;
  readonly token: string;
}

export interface Ownership {
  terminate(): void;
  dispose(): void;
}

export interface Platform {
  inspect(pid: number): Promise<Identity | undefined>;
  own(pid: number): Ownership;
}

export interface AdmittedProcess {
  readonly identity: Identity;
  terminate(expected: Identity): Promise<void>;
  dispose(): void;
}

export const admitProcess = async (platform: Platform, pid: number): Promise<AdmittedProcess> => {
  const identity = await platform.inspect(pid);
  if (!identity) throw new Error('Process exited before admission');
  const ownership = platform.own(pid);
  return {
    identity,
    dispose: () => ownership.dispose(),
    async terminate(expected) {
      const current = await platform.inspect(pid);
      if (
        expected.pid !== pid ||
        expected.token !== identity.token ||
        current?.token !== identity.token
      ) {
        throw new Error('Process identity does not match');
      }
      ownership.terminate();
    },
  };
};

const posixOwnership = (pid: number): Ownership => ({
  dispose() {},
  terminate() {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error;
    }
  },
});

export const createPlatform = async (): Promise<Platform> => {
  if (process.platform === 'linux') {
    return {
      async inspect(pid) {
        try {
          const identity = await inspectLinuxProcessIdentity(pid);
          return { pid, token: identity.fingerprint };
        } catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            // The native CI runner is known to have procfs; this is not a recovery adapter.
            return undefined;
          }
          throw error;
        }
      },
      own: posixOwnership,
    };
  }
  if (process.platform === 'darwin') {
    const { inspectDarwin } = await import('./darwin.js');
    return { inspect: inspectDarwin, own: posixOwnership };
  }
  if (process.platform === 'win32') {
    const { windowsPlatform } = await import('./windows.js');
    return windowsPlatform;
  }
  throw new Error(`Unsupported PoC platform: ${process.platform}`);
};
