import type {
  ExecutableProbePort,
  ExecutableResolution,
  ProbeHostPlatform,
  RunningVersionProbe,
  VersionProbeObservation,
} from '../../../src/execution/probe/port.js';

interface ProbeCall {
  readonly type: 'resolve' | 'version' | 'terminate';
  readonly value?: unknown;
}

export interface ExecutableProbeStory {
  readonly port: ExecutableProbePort;
  readonly calls: readonly ProbeCall[];
}

const never = new Promise<void>(() => undefined);

export const exitedProbe = (
  output: Uint8Array | string,
  options: {
    readonly stream?: 'stdout' | 'stderr';
    readonly exitCode?: number | null;
    readonly signal?: string | null;
    readonly overflow?: VersionProbeObservation extends infer _
      ? 'none' | 'stdout' | 'stderr' | 'both'
      : never;
  } = {},
): VersionProbeObservation => {
  const bytes = typeof output === 'string' ? new TextEncoder().encode(output) : output;
  return Object.freeze({
    exitCode: options.exitCode ?? 0,
    overflow: options.overflow ?? 'none',
    signal: options.signal ?? null,
    status: 'exited',
    stderr: options.stream === 'stderr' ? bytes : new Uint8Array(),
    stdout: options.stream === 'stderr' ? new Uint8Array() : bytes,
  });
};

export const executableProbeStory = (
  options: {
    readonly platform?: ProbeHostPlatform;
    readonly resolution?: ExecutableResolution | Error;
    readonly observation?: VersionProbeObservation | Error;
    readonly timeout?: boolean;
    readonly cleanupFails?: boolean;
  } = {},
): ExecutableProbeStory => {
  const calls: ProbeCall[] = [];
  const running: RunningVersionProbe = {
    completion:
      options.observation instanceof Error
        ? Promise.reject(options.observation)
        : options.timeout === true
          ? new Promise(() => undefined)
          : Promise.resolve(options.observation ?? exitedProbe('1.0.0\n')),
    terminateAndReap: async () => {
      calls.push({ type: 'terminate' });
      if (options.cleanupFails === true) throw new Error('fixture cleanup failed');
    },
    timeout: options.timeout === true ? Promise.resolve() : never,
  };
  return {
    calls,
    port: {
      hostPlatform: () => options.platform ?? 'linux',
      resolveExecutable: async (command) => {
        calls.push({ type: 'resolve', value: command });
        if (options.resolution instanceof Error) throw options.resolution;
        return (
          options.resolution ?? Object.freeze({ executable: '/resolved/agent', status: 'resolved' })
        );
      },
      startVersionProbe: async (request) => {
        calls.push({ type: 'version', value: request });
        return running;
      },
    },
  };
};
