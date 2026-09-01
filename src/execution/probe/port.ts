export type ProbeHostPlatform = 'darwin' | 'linux' | 'win32' | 'other';

export type ExecutableResolution =
  | Readonly<{ status: 'resolved'; executable: string }>
  | Readonly<{ status: 'unavailable'; reason: 'not_found' | 'not_launchable' }>;

export type VersionProbeOverflow = 'none' | 'stdout' | 'stderr' | 'both';

export type VersionProbeObservation =
  | Readonly<{ status: 'spawn_failed' }>
  | Readonly<{
      status: 'exited';
      exitCode: number | null;
      signal: string | null;
      stdout: Uint8Array;
      stderr: Uint8Array;
      overflow: VersionProbeOverflow;
    }>;

export interface RunningVersionProbe {
  readonly completion: Promise<VersionProbeObservation>;
  readonly timeout: Promise<void>;
  terminateAndReap(): Promise<void>;
}

export interface ExecutableProbePort {
  hostPlatform(): ProbeHostPlatform;
  resolveExecutable(command: string): Promise<ExecutableResolution>;
  startVersionProbe(request: {
    readonly executable: string;
    readonly args: readonly string[];
    readonly environment: Readonly<Record<string, string>>;
    readonly shell: false;
    readonly timeoutMs: number;
    readonly stdoutLimitBytes: 65_536;
    readonly stderrLimitBytes: 65_536;
  }): Promise<RunningVersionProbe>;
}
