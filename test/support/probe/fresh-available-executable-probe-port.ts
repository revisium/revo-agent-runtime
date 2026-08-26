import type {
  ExecutableProbePort,
  ExecutableResolution,
  ProbeHostPlatform,
  RunningVersionProbe,
  VersionProbeRequest,
} from '../../../src/runtime/probe/index.js';

export class FreshAvailableExecutableProbePort implements ExecutableProbePort {
  constructor(
    private readonly executable: string,
    private readonly reportedVersion: string,
  ) {}

  hostPlatform(): ProbeHostPlatform {
    return 'linux';
  }

  resolveExecutable(): Promise<ExecutableResolution> {
    return Promise.resolve(Object.freeze({ status: 'resolved', executable: this.executable }));
  }

  startVersionProbe(_request: VersionProbeRequest): Promise<RunningVersionProbe> {
    return Promise.resolve(
      Object.freeze({
        completion: Promise.resolve(
          Object.freeze({
            status: 'exited' as const,
            exitCode: 0,
            signal: null,
            stdout: new TextEncoder().encode(`agent ${this.reportedVersion}\n`),
            stderr: new Uint8Array(),
            overflow: 'none' as const,
          }),
        ),
        timeout: new Promise<void>(() => undefined),
        terminateAndReap: () => Promise.resolve(undefined),
      }),
    );
  }
}
