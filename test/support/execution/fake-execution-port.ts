import type { InvocationExecutionPorts } from '../../../src/runtime/execution/index.js';

export type InvocationExecutionCall =
  | { readonly type: 'start' }
  | { readonly type: 'request-cancellation'; readonly executionId: number };

export interface FakeInvocationExecutionControls {
  enqueueStart(result: 'running' | Error): void;
  settleCancellationRequest(executionId: number): void;
  rejectCancellationRequest(executionId: number, error: Error): void;
  settleNaturalCompletion(executionId: number): void;
  confirmCancellation(executionId: number): void;
  settleCompletionFailure(executionId: number, error: Error): void;
  calls(): readonly InvocationExecutionCall[];
}

type InvocationExecutionPort = InvocationExecutionPorts['execution'];

type CompletionObservation = Awaited<
  Awaited<ReturnType<InvocationExecutionPorts['execution']['start']>>['completion']
>;

type CancellationRequestState = 'unrequested' | 'pending' | 'fulfilled' | 'rejected';

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
  readonly reject: (reason: Error) => void;
}

interface PendingExecution {
  readonly completion: Deferred<CompletionObservation>;
  cancellationRequest: Deferred<void> | undefined;
  cancellationRequestState: CancellationRequestState;
  completionSettled: boolean;
}

const deferred = <Value>(): Deferred<Value> => {
  let resolve: ((value: Value) => void) | undefined;
  let reject: ((reason: Error) => void) | undefined;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  if (resolve === undefined || reject === undefined) {
    throw new Error('Unable to create a deferred test helper');
  }

  return { promise, resolve, reject };
};

export class FakeInvocationExecutionPort
  implements InvocationExecutionPort, FakeInvocationExecutionControls
{
  private readonly startQueue: ('running' | Error)[] = [];
  private readonly executions = new Map<number, PendingExecution>();
  private readonly callLog: InvocationExecutionCall[] = [];
  private nextExecutionId = 1;

  enqueueStart(result: 'running' | Error): void {
    this.startQueue.push(result);
  }

  async start(): Promise<{
    readonly completion: Promise<CompletionObservation>;
    requestCancellation(): Promise<void>;
  }> {
    this.record(Object.freeze({ type: 'start' }));
    const result = this.takeStart();

    if (result instanceof Error) {
      throw result;
    }

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
      completion: execution.completion.promise,
      requestCancellation: () => this.requestCancellation(executionId),
    };
  }

  settleCancellationRequest(executionId: number): void {
    const execution = this.execution(executionId);
    this.requirePendingCancellationRequest(executionId, execution);
    execution.cancellationRequestState = 'fulfilled';
    execution.cancellationRequest?.resolve(undefined);
  }

  rejectCancellationRequest(executionId: number, error: Error): void {
    const execution = this.execution(executionId);
    this.requirePendingCancellationRequest(executionId, execution);
    execution.cancellationRequestState = 'rejected';
    execution.cancellationRequest?.reject(error);
  }

  settleNaturalCompletion(executionId: number): void {
    const execution = this.execution(executionId);
    this.requireUnsettledCompletion(executionId, execution);
    this.rejectPendingCancellationForNaturalCompletion(execution);
    execution.completionSettled = true;
    execution.completion.resolve(Object.freeze({ status: 'completed' }));
  }

  confirmCancellation(executionId: number): void {
    const execution = this.execution(executionId);
    this.requireUnsettledCompletion(executionId, execution);
    if (execution.cancellationRequestState !== 'fulfilled') {
      throw new Error(`Cancellation request for execution ${executionId} is not accepted`);
    }

    execution.completionSettled = true;
    execution.completion.resolve(Object.freeze({ status: 'cancelled' }));
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
      this.callLog.map((call) => {
        if (call.type === 'start') {
          return Object.freeze({ type: 'start' } as const);
        }

        return Object.freeze({
          type: 'request-cancellation' as const,
          executionId: call.executionId,
        });
      }),
    );
  }

  private requestCancellation(executionId: number): Promise<void> {
    const execution = this.execution(executionId);
    this.record(Object.freeze({ type: 'request-cancellation', executionId }));
    if (execution.completionSettled) {
      return Promise.reject(new Error('Execution already completed'));
    }
    if (execution.cancellationRequestState !== 'unrequested') {
      throw new Error(`Cancellation request for execution ${executionId} is already requested`);
    }

    const cancellationRequest = deferred<void>();
    execution.cancellationRequest = cancellationRequest;
    execution.cancellationRequestState = 'pending';
    return cancellationRequest.promise;
  }

  private takeStart(): 'running' | Error {
    const result = this.startQueue.shift();
    if (result === undefined) {
      throw new Error('No start result is queued');
    }

    return result;
  }

  private execution(executionId: number): PendingExecution {
    const execution = this.executions.get(executionId);
    if (execution === undefined) {
      throw new Error(`Unknown execution id ${executionId}`);
    }

    return execution;
  }

  private requirePendingCancellationRequest(
    executionId: number,
    execution: PendingExecution,
  ): void {
    if (execution.cancellationRequestState !== 'pending') {
      throw new Error(`Cancellation request for execution ${executionId} is not pending`);
    }
  }

  private requireUnsettledCompletion(executionId: number, execution: PendingExecution): void {
    if (execution.completionSettled) {
      throw new Error(`Completion for execution ${executionId} is already settled`);
    }
  }

  private rejectPendingCancellationForNaturalCompletion(execution: PendingExecution): void {
    this.rejectPendingCancellationRequest(
      execution,
      new Error('Execution completed before cancellation request was accepted'),
    );
  }

  private rejectPendingCancellationRequest(execution: PendingExecution, error: Error): void {
    if (execution.cancellationRequestState !== 'pending') {
      return;
    }

    execution.cancellationRequestState = 'rejected';
    execution.cancellationRequest?.reject(error);
  }

  private record(call: InvocationExecutionCall): void {
    this.callLog.push(call);
  }
}
