/** Portable execution-process contracts implemented by platform adapters. */
export interface ProcessExit {
  readonly exitCode: number | null;
  readonly signal: string | null;
}

export interface ProcessIdentity {
  readonly pid: number;
  readonly processGroupId: number;
  readonly fingerprint: string;
  readonly startedAt: string;
}

export type ProcessCleanupOutcome =
  | { readonly status: 'confirmed'; readonly exit: ProcessExit }
  | { readonly status: 'uncertain' };

export interface OwnedProcess {
  readonly identity: ProcessIdentity;
  readonly transport: {
    readonly input: WritableStream<Uint8Array>;
    readonly output: ReadableStream<Uint8Array>;
  };
  readonly completion: Promise<ProcessExit>;
  terminateAndReap(): Promise<ProcessCleanupOutcome>;
}

export interface ProcessLaunch {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly onStdout?: (chunk: Uint8Array) => void;
  readonly onStderr?: (chunk: Uint8Array) => void;
}

export interface ProcessSpawner {
  start(launch: ProcessLaunch, signal: AbortSignal): Promise<OwnedProcess>;
}

export type RecoveredProcessReconciliation =
  | { readonly status: 'absent' }
  | { readonly status: 'identity_mismatch' }
  | { readonly status: 'terminated' }
  | { readonly status: 'inconclusive' }
  | { readonly status: 'termination_unconfirmed' };

export interface RecoveredProcessInspector {
  inspectAndReconcileRecoveredProcess(
    identity: ProcessIdentity,
    signal: AbortSignal,
  ): Promise<RecoveredProcessReconciliation>;
}

export class ProcessStartError extends Error {
  constructor(readonly cleanup: 'confirmed' | 'uncertain') {
    super('Owned process start failed.');
    this.name = 'ProcessStartError';
  }
}
