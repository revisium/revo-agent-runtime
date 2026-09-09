import type { ActiveProcessIdentity } from '../../contracts/manager/core.js';

/** Portable execution-process contracts implemented by platform adapters. */
export interface ProcessExit {
  readonly exitCode: number | null;
  readonly signal: string | null;
}

export type ProcessIdentity = ActiveProcessIdentity;
export type ProcessGroupIdentity = Exclude<ProcessIdentity, { readonly platform: 'win32' }>;

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
