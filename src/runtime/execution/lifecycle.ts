import type { InvocationExecutionPorts } from './execution-ports.js';
import type { InvocationTerminalObservation } from './execution-terminal-observation.js';
import { finalizeInvocationOutcome } from './finalize-invocation-outcome.js';
import { InvocationInputSnapshot } from './input-snapshot.js';
import { normalizeInvocationOutcome } from './normalize-invocation-outcome.js';
import type { NormalizedInvocationOutcome } from './normalized-invocation-outcome.js';
import type { PreparedLaunch } from './prepared-launch.js';

type LifecycleState =
  | 'accepted'
  | 'starting'
  | 'running'
  | 'cancelling'
  | 'finalizing'
  | 'terminal';
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
  private settlement: NormalizedInvocationOutcome | undefined;
  private state: LifecycleState = 'accepted';

  constructor(
    private readonly ports: InvocationExecutionPorts,
    private readonly snapshot: InvocationInputSnapshot,
    private readonly preparedLaunch: PreparedLaunch,
    private readonly onTerminal: (settlement: NormalizedInvocationOutcome) => void,
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

  terminalSettlement(): NormalizedInvocationOutcome | undefined {
    return this.settlement;
  }

  private async startExecution(): Promise<void> {
    try {
      const execution = await this.ports.execution.start(this.snapshot, this.preparedLaunch);
      if (this.state === 'terminal' || this.state === 'finalizing') return;
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
        (observation) => this.beginFinalization(observation),
        () => this.beginFinalization(Object.freeze({ status: 'failed' })),
      );
    } catch (error: unknown) {
      this.cancellation?.reject(error);
      this.beginFinalization(Object.freeze({ status: 'failed' }));
    }
  }

  private requestCancellationFor(cause: CancellationCause): Promise<void> {
    if (this.state === 'terminal' || this.state === 'finalizing') return Promise.resolve();
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
    if (
      execution === undefined ||
      cancellation === undefined ||
      this.state === 'terminal' ||
      this.state === 'finalizing'
    )
      return;
    void Promise.resolve()
      .then(() => execution.requestCancellation())
      .then(cancellation.resolve, (error: unknown) => {
        cancellation.reject(error);
        queueMicrotask(() => this.beginFinalization(Object.freeze({ status: 'failed' })));
      });
  }

  private beginFinalization(observation: InvocationTerminalObservation): void {
    if (this.state === 'terminal' || this.state === 'finalizing') return;
    this.state = 'finalizing';
    this.deadlineCancellation?.();
    void this.finalize(observation);
  }

  private async finalize(observation: InvocationTerminalObservation): Promise<void> {
    let normalized: NormalizedInvocationOutcome;
    try {
      normalized =
        observation.status === 'cancelled'
          ? Object.freeze({
              status:
                this.cancellationCause === 'deadline'
                  ? ('timed_out' as const)
                  : ('cancelled' as const),
            })
          : normalizeInvocationOutcome(observation, this.preparedLaunch.resultSchemaValidator);
    } catch {
      normalized = Object.freeze({ status: 'failed', reason: 'execution_failed' });
    }

    let settlement: NormalizedInvocationOutcome;
    try {
      settlement = await finalizeInvocationOutcome(this.ports.output, normalized);
    } catch {
      settlement = Object.freeze({ status: 'failed', reason: 'execution_failed' });
    }
    this.settlement = settlement;
    this.state = 'terminal';
    this.onTerminal(settlement);
  }
}
