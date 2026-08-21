import {
  settleProcessStart,
  type ProcessStartAttempt,
} from '../../../src/runtime/execution/index.js';

export type FakeProcessStartOperation = 'accepted' | 'failed' | 'pending' | 'throw-on-dispatch';

export class FakeProcessStartPort {
  private readonly queue: FakeProcessStartOperation[] = [];
  private readonly attemptLog: ProcessStartAttempt[] = [];
  private readonly pendingAttempts = new Map<number, ProcessStartAttempt>();
  private nextPendingStartId = 1;

  constructor(private readonly defaultOperation?: FakeProcessStartOperation) {}

  enqueue(operation: FakeProcessStartOperation): void {
    this.queue.push(operation);
  }

  beginStart(attempt: ProcessStartAttempt): void {
    this.attemptLog.push(attempt);
    const operation = this.queue.shift() ?? this.defaultOperation;
    if (operation === undefined) throw new Error('No process start operation is queued');
    if (operation === 'throw-on-dispatch') throw new Error('process start dispatch failed');
    if (operation === 'accepted') {
      settleProcessStart(attempt, { status: 'accepted', spawnedAt: 123_456 });
      return;
    }
    if (operation === 'failed') {
      settleProcessStart(attempt, { status: 'failed' });
      return;
    }

    const pendingId = this.nextPendingStartId;
    this.nextPendingStartId += 1;
    this.pendingAttempts.set(pendingId, attempt);
  }

  settlePendingAccepted(startId: number, spawnedAt = 123_456): void {
    const attempt = this.takePending(startId);
    settleProcessStart(attempt, { status: 'accepted', spawnedAt });
  }

  settlePendingFailed(startId: number): void {
    const attempt = this.takePending(startId);
    settleProcessStart(attempt, { status: 'failed' });
  }

  attempts(): readonly ProcessStartAttempt[] {
    return Object.freeze([...this.attemptLog]);
  }

  pendingStartCount(): number {
    return this.pendingAttempts.size;
  }

  private takePending(startId: number): ProcessStartAttempt {
    const attempt = this.pendingAttempts.get(startId);
    if (attempt === undefined) throw new Error(`Unknown pending process start ${startId}`);
    this.pendingAttempts.delete(startId);
    return attempt;
  }
}
