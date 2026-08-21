import type {
  OutputPreparationMutationPort,
  OutputPreparationMutationRequest,
  OutputPreparationPlatformResult,
  ProcessOutputSink,
} from '../../../src/runtime/execution/index.js';

export type FakeOutputPreparationOperation =
  | 'prepared'
  | 'scratch-conflict'
  | 'scratch-create-failed'
  | 'scratch-write-failed'
  | 'scratch-flush-failed'
  | 'redaction-sink-create-failed'
  | 'evidence-open-failed'
  | 'rejected-without-dispatch'
  | 'pending'
  | 'pending-without-dispatch'
  | 'reject'
  | 'reject-without-dispatch'
  | 'throw-before-dispatch'
  | 'throw-after-dispatch'
  | 'non-promise-return';

interface PendingPreparation {
  readonly request: OutputPreparationMutationRequest;
  readonly resolve: (result: OutputPreparationPlatformResult) => void;
  readonly reject: (error: Error) => void;
}

const createFakeRedactionChannel = () =>
  Object.freeze({
    feed: (chunk: Uint8Array): Uint8Array => chunk.slice(),
    flush: (): Uint8Array => new Uint8Array(),
    dispose: (): void => undefined,
  });

const createFakeFrontEnds = () =>
  Object.freeze({
    stdout: createFakeRedactionChannel(),
    stderr: createFakeRedactionChannel(),
    rawResponse: createFakeRedactionChannel(),
  });

const createFakeEvidenceSink = (): ProcessOutputSink =>
  Object.freeze({
    write: async (): Promise<void> => undefined,
    end: async (): Promise<void> => undefined,
  });

const prepared = (): OutputPreparationPlatformResult =>
  Object.freeze({
    status: 'prepared',
    attestations: Object.freeze([]),
    frontEnds: createFakeFrontEnds(),
    evidenceSinks: Object.freeze({
      stdout: createFakeEvidenceSink(),
      stderr: createFakeEvidenceSink(),
    }),
  });

const platformRejected = (
  reason: Extract<OutputPreparationPlatformResult, { status: 'rejected' }>['reason'],
): OutputPreparationPlatformResult => Object.freeze({ status: 'rejected', reason });

export class FakeOutputPreparationPort implements OutputPreparationMutationPort {
  private readonly queue: FakeOutputPreparationOperation[] = [];
  private readonly pendingPreparations = new Map<number, PendingPreparation>();
  private readonly requestLog: OutputPreparationMutationRequest[] = [];
  private nextPendingPreparationId = 1;

  constructor(private readonly defaultOperation?: FakeOutputPreparationOperation) {}

  enqueue(operation: FakeOutputPreparationOperation): void {
    this.queue.push(operation);
  }

  prepareClaimedOutput(
    request: OutputPreparationMutationRequest,
  ): Promise<OutputPreparationPlatformResult> {
    this.requestLog.push(request);
    const operation = this.queue.shift() ?? this.defaultOperation;
    if (operation === undefined) throw new Error('No output preparation operation is queued');
    if (operation === 'throw-before-dispatch') throw new Error('failed before mutation dispatch');
    if (operation === 'rejected-without-dispatch')
      return Promise.resolve(platformRejected('scratch_create_failed'));
    if (operation === 'pending-without-dispatch')
      return new Promise<OutputPreparationPlatformResult>(() => undefined);
    if (operation === 'reject-without-dispatch')
      return Promise.reject(new Error('preparation failed'));
    if (operation === 'non-promise-return')
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      return { status: 'prepared' } as unknown as Promise<OutputPreparationPlatformResult>;

    request.markMutationDispatched();
    if (operation === 'throw-after-dispatch') throw new Error('failed after mutation dispatch');
    if (operation === 'prepared') return Promise.resolve(prepared());
    if (operation === 'reject') return Promise.reject(new Error('preparation failed'));
    if (operation === 'scratch-conflict')
      return Promise.resolve(platformRejected('scratch_conflict'));
    if (operation === 'scratch-create-failed')
      return Promise.resolve(platformRejected('scratch_create_failed'));
    if (operation === 'scratch-write-failed')
      return Promise.resolve(platformRejected('scratch_write_failed'));
    if (operation === 'scratch-flush-failed')
      return Promise.resolve(platformRejected('scratch_flush_failed'));
    if (operation === 'redaction-sink-create-failed')
      return Promise.resolve(platformRejected('redaction_sink_create_failed'));
    if (operation === 'evidence-open-failed')
      return Promise.resolve(platformRejected('evidence_open_failed'));

    const pendingId = this.nextPendingPreparationId;
    this.nextPendingPreparationId += 1;
    return new Promise<OutputPreparationPlatformResult>((resolve, reject) => {
      this.pendingPreparations.set(pendingId, Object.freeze({ request, resolve, reject }));
    });
  }

  settlePendingPrepared(preparationId: number): void {
    this.settlePending(preparationId, prepared());
  }

  settlePendingRejected(
    preparationId: number,
    reason: Extract<OutputPreparationPlatformResult, { status: 'rejected' }>['reason'],
  ): void {
    this.settlePending(preparationId, platformRejected(reason));
  }

  rejectPending(preparationId: number): void {
    const pending = this.pendingPreparations.get(preparationId);
    if (pending === undefined)
      throw new Error(`Unknown pending output preparation ${preparationId}`);
    this.pendingPreparations.delete(preparationId);
    pending.reject(new Error('preparation failed'));
  }

  requests(): readonly OutputPreparationMutationRequest[] {
    return Object.freeze([...this.requestLog]);
  }

  pendingPreparationCount(): number {
    return this.pendingPreparations.size;
  }

  private settlePending(preparationId: number, result: OutputPreparationPlatformResult): void {
    const pending = this.pendingPreparations.get(preparationId);
    if (pending === undefined)
      throw new Error(`Unknown pending output preparation ${preparationId}`);
    this.pendingPreparations.delete(preparationId);
    pending.resolve(result);
  }
}
