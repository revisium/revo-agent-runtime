/** Portable execution-process contracts implemented by platform adapters. */
export interface ProcessExit {
  readonly exitCode: number | null;
  readonly signal: string | null;
}

interface ProcessIdentityEvidence {
  readonly pid: number;
  readonly fingerprint: string;
  readonly startedAt: string;
}

export type ProcessIdentity = ProcessIdentityEvidence &
  (
    | { readonly version?: never; readonly platform?: never; readonly processGroupId: number }
    | {
        readonly version: 2;
        readonly platform: 'linux' | 'darwin';
        readonly processGroupId: number;
      }
    | { readonly version: 2; readonly platform: 'win32'; readonly jobName: string }
  );

export type ProcessGroupIdentity = Exclude<ProcessIdentity, { readonly platform: 'win32' }>;
export type ProcessIdentityInspector = (pid: number) => Promise<ProcessGroupIdentity>;

export type ProcessCleanupOutcome =
  | { readonly status: 'confirmed'; readonly exit: ProcessExit }
  | { readonly status: 'uncertain' };

export interface OwnedProcess {
  readonly identity: ProcessIdentity;
  readonly transport: {
    readonly input: WritableStream<Uint8Array>;
    readonly output: ReadableStream<Uint8Array>;
  };
  /** Native leader exit; inherited output pipes can still be open. */
  readonly completion: Promise<ProcessExit>;
  /** Confirms group/Job termination and closure of the local pipes. */
  terminateAndReap(): Promise<ProcessCleanupOutcome>;
}

export interface ProcessLaunch {
  /** Executable path resolved by the caller before admission. */
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

/** Ownership for bounded probes which need no durable, live process identity. */
export type ProcessRun = Omit<OwnedProcess, 'identity'>;
export interface ProcessLauncher {
  start(launch: ProcessLaunch, signal: AbortSignal): Promise<ProcessRun>;
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
  constructor(
    readonly cleanup: 'confirmed' | 'uncertain',
    options?: ErrorOptions,
  ) {
    super('Owned process start failed.', options);
    this.name = 'ProcessStartError';
  }
}
