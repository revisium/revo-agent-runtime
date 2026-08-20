import type {
  OutputClaimExclusiveCreatePort,
  OutputClaimExclusiveCreateRequest,
  OutputClaimPlatformResult,
} from '../../../src/runtime/execution/index.js';

export type FakeOutputClaimOperation =
  | 'created'
  | 'leaf-exists'
  | 'create-failed'
  | 'pending'
  | 'pending-without-dispatch'
  | 'reject'
  | 'throw-before-dispatch'
  | 'throw-after-dispatch'
  | 'non-promise-return';

interface PendingClaim {
  readonly request: OutputClaimExclusiveCreateRequest;
  readonly resolve: (result: OutputClaimPlatformResult) => void;
  readonly reject: (error: Error) => void;
}

export class FakeOutputClaimPort implements OutputClaimExclusiveCreatePort {
  private readonly queue: FakeOutputClaimOperation[] = [];
  private readonly pendingClaims = new Map<number, PendingClaim>();
  private readonly requestLog: OutputClaimExclusiveCreateRequest[] = [];
  private nextPendingClaimId = 1;

  enqueue(operation: FakeOutputClaimOperation): void {
    this.queue.push(operation);
  }

  createExclusiveOutputDirectory(
    request: OutputClaimExclusiveCreateRequest,
  ): Promise<OutputClaimPlatformResult> {
    this.requestLog.push(request);
    const operation = this.queue.shift();
    if (operation === undefined) throw new Error('No output claim operation is queued');
    if (operation === 'throw-before-dispatch') throw new Error('failed before syscall dispatch');
    if (operation === 'pending-without-dispatch')
      return new Promise<OutputClaimPlatformResult>(() => undefined);
    // Deliberately violates the port's return-type contract to exercise
    // create-output-claim-attempt's defensive thenable check; remove only if
    // that check or this operation is removed.
    if (operation === 'non-promise-return')
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      return { status: 'created' } as unknown as Promise<OutputClaimPlatformResult>;

    request.markSyscallDispatched();
    if (operation === 'throw-after-dispatch') throw new Error('failed after syscall dispatch');
    if (operation === 'created') return Promise.resolve({ status: 'created' });
    if (operation === 'reject') return Promise.reject(new Error('exclusive create failed'));
    if (operation === 'leaf-exists') return Promise.resolve({ status: 'leaf_exists' });
    if (operation === 'create-failed') return Promise.resolve({ status: 'create_failed' });

    const pendingId = this.nextPendingClaimId;
    this.nextPendingClaimId += 1;
    return new Promise<OutputClaimPlatformResult>((resolve, reject) => {
      this.pendingClaims.set(pendingId, Object.freeze({ request, resolve, reject }));
    });
  }

  settlePendingCreated(claimId: number): void {
    this.settlePending(claimId, { status: 'created' });
  }

  settlePendingLeafExists(claimId: number): void {
    this.settlePending(claimId, { status: 'leaf_exists' });
  }

  settlePendingCreateFailed(claimId: number): void {
    this.settlePending(claimId, { status: 'create_failed' });
  }

  rejectPending(claimId: number): void {
    const pending = this.pendingClaims.get(claimId);
    if (pending === undefined) throw new Error(`Unknown pending output claim ${claimId}`);
    this.pendingClaims.delete(claimId);
    pending.reject(new Error('exclusive create failed'));
  }

  requests(): readonly OutputClaimExclusiveCreateRequest[] {
    return Object.freeze([...this.requestLog]);
  }

  pendingClaimCount(): number {
    return this.pendingClaims.size;
  }

  private settlePending(claimId: number, result: OutputClaimPlatformResult): void {
    const pending = this.pendingClaims.get(claimId);
    if (pending === undefined) throw new Error(`Unknown pending output claim ${claimId}`);
    this.pendingClaims.delete(claimId);
    pending.resolve(result);
  }
}
