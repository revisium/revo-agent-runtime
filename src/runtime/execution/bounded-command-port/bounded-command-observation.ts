export type BoundedCommandObservation =
  | {
      readonly status: 'exited';
      readonly exitCode: number | null;
      readonly signal: NodeJS.Signals | null;
      readonly stdout: Uint8Array;
      readonly stderr: Uint8Array;
      readonly overflow: 'none' | 'stdout' | 'stderr' | 'both';
    }
  | { readonly status: 'spawn_failed' };
