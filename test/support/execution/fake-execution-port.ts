import {
  BoundedRawResponseEvidence,
  InvocationInputSnapshot,
  type ProcessCleanupAttemptOutcome,
  type InvocationExecutionPorts,
  type PreparedLaunch,
} from '../../../src/runtime/execution/index.js';

export type InvocationExecutionCall =
  | { readonly type: 'start' }
  | { readonly type: 'request-cancellation'; readonly executionId: number };

export interface FakeInvocationExecutionControls {
  enqueueStart(result: 'running' | Error): void;
  enqueuePendingStart(): void;
  fulfilPendingStart(startId: number): void;
  rejectPendingStart(startId: number, error: Error): void;
  settleCancellationRequest(executionId: number, outcome?: ProcessCleanupAttemptOutcome): void;
  rejectCancellationRequest(executionId: number, error: Error): void;
  settleNaturalCompletion(executionId: number, rawResponse?: Uint8Array): void;
  confirmCancellation(executionId: number): void;
  settleCompletionFailure(executionId: number, error: Error): void;
  calls(): readonly InvocationExecutionCall[];
  startedPreparedLaunches(): readonly PreparedLaunch[];
  startedSnapshots(): readonly InvocationInputSnapshot[];
}

type InvocationExecutionPort = InvocationExecutionPorts['execution'];
type RunningExecution = Awaited<ReturnType<InvocationExecutionPorts['execution']['start']>>;
type CompletionObservation = Awaited<RunningExecution['completion']>;
type CancellationRequestState = 'unrequested' | 'pending' | 'fulfilled' | 'rejected';
type StartResult = 'running' | 'pending' | Error;

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
  readonly reject: (reason: Error) => void;
}

interface PendingExecution {
  readonly completion: Deferred<CompletionObservation>;
  cancellationRequest: Deferred<ProcessCleanupAttemptOutcome | undefined> | undefined;
  cancellationRequestState: CancellationRequestState;
  completionSettled: boolean;
}

const defaultSpawnedAt = 123_456;

const rawResponseEvidence = (bytes: Uint8Array) =>
  BoundedRawResponseEvidence.create({
    byteLength: bytes.byteLength,
    bytes,
    previewBytes: bytes.byteLength,
  });

const deferred = <Value>(): Deferred<Value> => {
  let resolve: ((value: Value) => void) | undefined;
  let reject: ((reason: Error) => void) | undefined;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  if (resolve === undefined || reject === undefined)
    throw new Error('Unable to create a deferred test helper');
  return { promise, resolve, reject };
};

export class FakeInvocationExecutionPort
  implements InvocationExecutionPort, FakeInvocationExecutionControls
{
  private readonly executions = new Map<number, PendingExecution>();
  private readonly callLog: InvocationExecutionCall[] = [];
  private readonly pendingStarts = new Map<number, Deferred<RunningExecution>>();
  private readonly preparedLaunches: PreparedLaunch[] = [];
  private readonly snapshots: InvocationInputSnapshot[] = [];
  private readonly startQueue: StartResult[] = [];
  private nextExecutionId = 1;
  private nextStartId = 1;

  enqueueStart(result: 'running' | Error): void {
    this.startQueue.push(result);
  }

  enqueuePendingStart(): void {
    this.startQueue.push('pending');
  }

  async start(
    snapshot: InvocationInputSnapshot,
    preparedLaunch: PreparedLaunch,
  ): Promise<RunningExecution> {
    this.record(Object.freeze({ type: 'start' }));
    this.snapshots.push(snapshot);
    this.preparedLaunches.push(preparedLaunch);
    const result = this.takeStart();
    if (result instanceof Error) throw result;
    if (result === 'pending') {
      const startId = this.nextStartId;
      this.nextStartId += 1;
      const pending = deferred<RunningExecution>();
      this.pendingStarts.set(startId, pending);
      return pending.promise;
    }
    return this.createExecution();
  }

  fulfilPendingStart(startId: number): void {
    const pending = this.pendingStart(startId);
    this.pendingStarts.delete(startId);
    pending.resolve(this.createExecution());
  }

  rejectPendingStart(startId: number, error: Error): void {
    const pending = this.pendingStart(startId);
    this.pendingStarts.delete(startId);
    pending.reject(error);
  }

  settleCancellationRequest(executionId: number, outcome?: ProcessCleanupAttemptOutcome): void {
    const execution = this.execution(executionId);
    this.requirePendingCancellationRequest(executionId, execution);
    execution.cancellationRequestState = 'fulfilled';
    execution.cancellationRequest?.resolve(outcome);
  }

  rejectCancellationRequest(executionId: number, error: Error): void {
    const execution = this.execution(executionId);
    this.requirePendingCancellationRequest(executionId, execution);
    execution.cancellationRequestState = 'rejected';
    execution.cancellationRequest?.reject(error);
  }

  settleNaturalCompletion(executionId: number, rawResponse?: Uint8Array): void {
    const execution = this.execution(executionId);
    this.requireUnsettledCompletion(executionId, execution);
    this.rejectPendingCancellationForNaturalCompletion(execution);
    execution.completionSettled = true;
    execution.completion.resolve(
      Object.freeze({
        status: 'completed',
        spawnedAt: defaultSpawnedAt,
        exit: Object.freeze({ exitCode: 0, signal: null }),
        ...(rawResponse === undefined ? {} : { rawResponse: rawResponseEvidence(rawResponse) }),
      }),
    );
  }

  confirmCancellation(executionId: number): void {
    const execution = this.execution(executionId);
    this.requireUnsettledCompletion(executionId, execution);
    if (execution.cancellationRequestState !== 'fulfilled')
      throw new Error(`Cancellation request for execution ${executionId} is not accepted`);
    execution.completionSettled = true;
    execution.completion.resolve(
      Object.freeze({
        status: 'cancelled',
        spawnedAt: defaultSpawnedAt,
        exit: Object.freeze({ exitCode: null, signal: 'SIGTERM' }),
      }),
    );
  }

  settleCompletionFailure(executionId: number, error: Error): void {
    const execution = this.execution(executionId);
    this.requireUnsettledCompletion(executionId, execution);
    this.rejectPendingCancellationRequest(execution, error);
    execution.completionSettled = true;
    execution.completion.reject(error);
  }

  calls(): readonly InvocationExecutionCall[] {
    return Object.freeze(
      this.callLog.map((call) =>
        call.type === 'start'
          ? Object.freeze({ type: 'start' } as const)
          : Object.freeze({ type: 'request-cancellation' as const, executionId: call.executionId }),
      ),
    );
  }

  startedSnapshots(): readonly InvocationInputSnapshot[] {
    return Object.freeze([...this.snapshots]);
  }

  startedPreparedLaunches(): readonly PreparedLaunch[] {
    return Object.freeze([...this.preparedLaunches]);
  }

  private createExecution(): RunningExecution {
    const executionId = this.nextExecutionId;
    this.nextExecutionId += 1;
    const execution: PendingExecution = {
      completion: deferred<CompletionObservation>(),
      cancellationRequest: undefined,
      cancellationRequestState: 'unrequested',
      completionSettled: false,
    };
    this.executions.set(executionId, execution);
    return {
      spawnedAt: defaultSpawnedAt,
      completion: execution.completion.promise,
      requestCancellation: () => this.requestCancellation(executionId),
    };
  }

  private requestCancellation(
    executionId: number,
  ): Promise<ProcessCleanupAttemptOutcome | undefined> {
    const execution = this.execution(executionId);
    this.record(Object.freeze({ type: 'request-cancellation', executionId }));
    if (execution.completionSettled)
      return Promise.reject(new Error('Execution already completed'));
    if (execution.cancellationRequestState !== 'unrequested')
      throw new Error(`Cancellation request for execution ${executionId} is already requested`);
    const cancellationRequest = deferred<ProcessCleanupAttemptOutcome | undefined>();
    execution.cancellationRequest = cancellationRequest;
    execution.cancellationRequestState = 'pending';
    return cancellationRequest.promise;
  }

  private takeStart(): StartResult {
    const result = this.startQueue.shift();
    if (result === undefined) throw new Error('No start result is queued');
    return result;
  }

  private pendingStart(startId: number): Deferred<RunningExecution> {
    const pending = this.pendingStarts.get(startId);
    if (pending === undefined) throw new Error(`Unknown pending start id ${startId}`);
    return pending;
  }

  private execution(executionId: number): PendingExecution {
    const execution = this.executions.get(executionId);
    if (execution === undefined) throw new Error(`Unknown execution id ${executionId}`);
    return execution;
  }

  private requirePendingCancellationRequest(
    executionId: number,
    execution: PendingExecution,
  ): void {
    if (execution.cancellationRequestState !== 'pending')
      throw new Error(`Cancellation request for execution ${executionId} is not pending`);
  }

  private requireUnsettledCompletion(executionId: number, execution: PendingExecution): void {
    if (execution.completionSettled)
      throw new Error(`Completion for execution ${executionId} is already settled`);
  }

  private rejectPendingCancellationForNaturalCompletion(execution: PendingExecution): void {
    this.rejectPendingCancellationRequest(
      execution,
      new Error('Execution completed before cancellation request was accepted'),
    );
  }

  private rejectPendingCancellationRequest(execution: PendingExecution, error: Error): void {
    if (execution.cancellationRequestState !== 'pending') return;
    execution.cancellationRequestState = 'rejected';
    execution.cancellationRequest?.reject(error);
  }

  private record(call: InvocationExecutionCall): void {
    this.callLog.push(call);
  }
}
