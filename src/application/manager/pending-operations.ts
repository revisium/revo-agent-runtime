export interface PendingOperation {
  cancel(): void;
  finish(): void;
  readonly quiescence: Promise<void>;
}

class TrackedPendingOperation implements PendingOperation {
  readonly quiescence: Promise<void>;
  private cancellationRequested = false;
  private finished = false;
  private cancelOperation: () => void;
  private readonly resolveQuiescence: () => void;

  constructor(
    cancel: () => void,
    private readonly release: (operation: PendingOperation) => void,
  ) {
    this.cancelOperation = cancel;
    let resolveQuiescence!: () => void;
    this.quiescence = new Promise<void>((resolve) => {
      resolveQuiescence = resolve;
    });
    this.resolveQuiescence = resolveQuiescence;
  }

  cancel(): void {
    if (this.finished || this.cancellationRequested) return;
    this.cancellationRequested = true;
    this.cancelOperation();
  }

  finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.release(this);
    this.resolveQuiescence();
  }
}

/** Owns cancellation and quiescence for manager operations not yet publicly accepted. */
export class PendingOperations {
  private readonly operations = new Set<PendingOperation>();

  track(cancel: () => void): PendingOperation {
    const operation = new TrackedPendingOperation(cancel, (finished) => {
      this.operations.delete(finished);
    });
    this.operations.add(operation);
    return operation;
  }

  cancelAll(): void {
    for (const operation of this.operations) operation.cancel();
  }

  async quiesce(): Promise<void> {
    await Promise.all([...this.operations].map((operation) => operation.quiescence));
  }

  get size(): number {
    return this.operations.size;
  }
}
