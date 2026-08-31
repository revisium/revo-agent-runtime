import type { ActiveInvocationStateSink, AgentExecutionPin } from '../../contracts/manager.js';
import type { ProcessIdentity } from '../../execution/process/port.js';
import { ActiveStateLane, type ActiveStateMutationOutcome } from './lane.js';
import { activeInvocationSnapshot } from './snapshot.js';

const applied = (outcome: ActiveStateMutationOutcome): boolean =>
  outcome === 'applied' || outcome === 'late_applied';

export class ActiveStateReservation {
  private readonly lane: ActiveStateLane;
  private cancellingObserved = false;
  private cancellingSaved = false;
  private runningSaved = false;

  constructor(
    private readonly invocationId: string,
    private readonly pin: AgentExecutionPin,
    private readonly process: ProcessIdentity,
    sink: ActiveInvocationStateSink,
    operationTimeoutMs: number,
    private readonly release: () => void,
  ) {
    this.lane = new ActiveStateLane(sink, operationTimeoutMs);
  }

  async saveRunning(): Promise<boolean> {
    const outcome = await this.lane.save(
      activeInvocationSnapshot(this.invocationId, this.pin, 'running', this.process),
    );
    this.runningSaved = outcome === 'applied';
    this.saveCancellingWhenReady();
    return this.runningSaved;
  }

  observeCancelling(): void {
    this.cancellingObserved = true;
    this.saveCancellingWhenReady();
  }

  async removeBeforeAcceptance(cleanupConfirmed: boolean): Promise<boolean> {
    const removal = this.lane.remove(this.invocationId).then((outcome) => {
      const removed = applied(outcome);
      if (cleanupConfirmed && removed) this.release();
      return removed;
    });
    const progress = await Promise.race([
      removal.then(() => 'settled' as const),
      this.lane.quiesce(),
    ]);
    return progress === 'unknown' ? false : removal;
  }

  async removeTerminal(): Promise<boolean> {
    return applied(await this.lane.remove(this.invocationId));
  }

  quiesce(): Promise<'confirmed' | 'unknown'> {
    return this.lane.quiesce();
  }

  private saveCancellingWhenReady(): void {
    if (!this.runningSaved || !this.cancellingObserved || this.cancellingSaved) return;
    this.cancellingSaved = true;
    void this.lane.save(
      activeInvocationSnapshot(this.invocationId, this.pin, 'cancelling', this.process),
    );
  }
}
