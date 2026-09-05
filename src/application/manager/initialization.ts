import type { ActiveInvocationStateSink } from '../../contracts/manager.js';
import type { SealedAgentRegistry } from '../../definition/index.js';
import type { RecoveredProcessInspector } from '../../execution/process/port.js';
import { recoverySnapshots } from '../active-state/recovery-snapshots.js';
import { beginActiveStateRecovery } from '../active-state/recovery.js';
import { activeStateError } from '../faults/agent-faults.js';

interface InitializationLimits {
  readonly activeStateOperationTimeoutMs: number;
  readonly initializationTimeoutMs: number;
}

/** Owns the single in-flight initialization and its recovery quiescence. */
export class ManagerInitialization {
  private initialized = false;
  private initialization: Promise<void> | undefined;
  private quiescence: Promise<void> = Promise.resolve();

  constructor(
    private readonly definitions: SealedAgentRegistry,
    private readonly activeStateSink: ActiveInvocationStateSink,
    private readonly recoveryInspector: RecoveredProcessInspector,
    private readonly limits: InitializationLimits,
  ) {}

  initialize(snapshots: unknown): Promise<void> {
    const parsed = recoverySnapshots(snapshots, this.definitions);
    if (parsed === undefined) return this.rejectInvalidSnapshots();

    const recovery = beginActiveStateRecovery(
      parsed,
      this.activeStateSink,
      this.recoveryInspector,
      this.limits.activeStateOperationTimeoutMs,
      this.limits.initializationTimeoutMs,
    );
    this.quiescence = recovery.quiescence;
    this.initialization = recovery.result.then(
      () => {
        this.initialized = true;
      },
      () => {
        throw activeStateError('manager');
      },
    );
    this.releaseFailedAttemptAfter(recovery.quiescence, this.initialization);
    return this.initialization;
  }

  get unresolved(): boolean {
    return !this.initialized && this.initialization !== undefined;
  }

  whenQuiescent(): Promise<void> {
    return this.quiescence;
  }

  private rejectInvalidSnapshots(): Promise<void> {
    this.initialization = Promise.reject(activeStateError('manager'));
    this.releaseFailedAttemptAfter(Promise.resolve(), this.initialization);
    return this.initialization;
  }

  private releaseFailedAttemptAfter(quiescence: Promise<void>, attempt: Promise<void>): void {
    void attempt
      .catch(() => undefined)
      .then(async () => {
        await quiescence;
        if (!this.initialized && this.initialization === attempt) this.initialization = undefined;
      });
  }
}
