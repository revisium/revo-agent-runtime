export interface VersionProbeRequest {
  readonly executable: string;
  readonly args: readonly string[];
  readonly shell: false;
  readonly timeoutMs: number;
  readonly stdoutLimitBytes: 65_536;
  readonly stderrLimitBytes: 65_536;
}
