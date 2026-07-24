import type { InvocationExecutionPorts } from './execution-ports.js';
import { InvocationInputSnapshot } from './input-snapshot.js';

type TerminalSettlement = Readonly<{
  status: 'completed' | 'failed' | 'cancelled' | 'timed_out';
}>;
type LifecycleState = 'accepted' | 'starting' | 'running' | 'cancelling' | 'terminal';
type CancellationCause = 'caller' | 'deadline';
type RunningExecution = Awaited<ReturnType<InvocationExecutionPorts['execution']['start']>>;

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (reason: unknown) => void;
}

const deferred = (): Deferred => {
  let resolve: (() => void) | undefined;
  let reject: ((reason: unknown) => void) | undefined;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  if (resolve === undefined || reject === undefined)
    throw new Error('Unable to create lifecycle cancellation');
  return { promise, resolve, reject };
};

export class InvocationLifecycle {
  private cancellation: Deferred | undefined;
  private cancellationCause: CancellationCause | undefined;
  private deadlineCancellation: (() => void) | undefined;
  private execution: RunningExecution | undefined;
  private settlement: TerminalSettlement | undefined;
  private state: LifecycleState = 'accepted';

  constructor(
    private readonly ports: InvocationExecutionPorts,
    private readonly snapshot: InvocationInputSnapshot,
    private readonly onTerminal: (settlement: TerminalSettlement) => void,
  ) {}

  begin(): void {
    if (this.state !== 'accepted') return;
    this.state = 'starting';
    void this.startExecution();
  }

  requestCancellation(): Promise<void> {
    return this.requestCancellationFor('caller');
  }

  currentState(): LifecycleState {
    return this.state;
  }

  terminalSettlement(): TerminalSettlement | undefined {
    return this.settlement;
  }

  private async startExecution(): Promise<void> {
    try {
      const execution = await this.ports.execution.start(this.snapshot);
      if (this.state === 'terminal') return;
      this.execution = execution;
      this.deadlineCancellation = this.ports.clock.schedule(
        this.snapshot.wallClockTimeoutMs,
        () => {
          void this.requestCancellationFor('deadline').catch(() => undefined);
        },
      );
      if (this.state === 'starting') this.state = 'running';
      else if (this.state === 'cancelling') this.dispatchCancellation();
      void execution.completion.then(
        (observation) => this.completeObservation(observation.status),
        () => this.commitTerminal('failed'),
      );
    } catch (error: unknown) {
      this.cancellation?.reject(error);
      this.commitTerminal('failed');
    }
  }

  private requestCancellationFor(cause: CancellationCause): Promise<void> {
    if (this.state === 'terminal') return Promise.resolve();
    if (this.cancellation !== undefined) return this.cancellation.promise;
    this.cancellationCause = cause;
    this.cancellation = deferred();
    this.state = 'cancelling';
    if (this.execution !== undefined) this.dispatchCancellation();
    return this.cancellation.promise;
  }

  private dispatchCancellation(): void {
    const execution = this.execution;
    const cancellation = this.cancellation;
    if (execution === undefined || cancellation === undefined || this.state === 'terminal') return;
    void Promise.resolve()
      .then(() => execution.requestCancellation())
      .then(cancellation.resolve, (error: unknown) => {
        cancellation.reject(error);
        queueMicrotask(() => this.commitTerminal('failed'));
      });
  }

  private completeObservation(status: 'completed' | 'cancelled'): void {
    if (status === 'completed') {
      this.commitTerminal('completed');
      return;
    }
    this.commitTerminal(this.cancellationCause === 'deadline' ? 'timed_out' : 'cancelled');
  }

  private commitTerminal(status: TerminalSettlement['status']): void {
    if (this.settlement !== undefined) return;
    const settlement = Object.freeze({ status });
    this.settlement = settlement;
    this.state = 'terminal';
    this.deadlineCancellation?.();
    this.onTerminal(settlement);
  }
}
