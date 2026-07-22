export type VersionProbeObservation =
  | {
      readonly status: 'exited';
      readonly exitCode: number | null;
      readonly signal: string | null;
      readonly stdout: Uint8Array;
      readonly stderr: Uint8Array;
      readonly overflow: 'none' | 'stdout' | 'stderr' | 'both';
    }
  | { readonly status: 'spawn_failed' };
