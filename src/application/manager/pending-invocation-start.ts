import type { AgentStartContext } from '../../contracts/manager.js';
import type { InvocationExecution } from '../../execution/invocation/executor.js';
import type { PendingOperation, PendingOperations } from './pending-operations.js';

/** Keeps one start cancellable before and after its process has been created. */
export class PendingInvocationStart {
  readonly signal: AbortSignal;
  private readonly cancellation = new AbortController();
  private readonly operation: PendingOperation;
  private cancelCurrent: () => void;
  private cancellationRequested = false;
  private pendingFinished = false;

  constructor(
    private readonly context: AgentStartContext | undefined,
    pendingOperations: PendingOperations,
  ) {
    this.signal = this.cancellation.signal;
    this.cancelCurrent = () => this.cancellation.abort();
    this.operation = pendingOperations.track(() => this.cancel());
    if (context?.signal?.aborted === true) this.cancel();
    else context?.signal?.addEventListener('abort', this.cancel, { once: true });
  }

  readonly cancel = (): void => {
    if (this.cancellationRequested) return;
    this.cancellationRequested = true;
    this.cancelCurrent();
  };

  bindExecution(execution: InvocationExecution): void {
    this.cancelCurrent = () => execution.cancel();
    if (this.cancellationRequested) this.cancelCurrent();
  }

  finishPending(): void {
    if (this.pendingFinished) return;
    this.pendingFinished = true;
    this.operation.finish();
  }

  dispose(): void {
    this.finishPending();
    this.context?.signal?.removeEventListener('abort', this.cancel);
  }
}
