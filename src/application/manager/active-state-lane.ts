import type {
  ActiveInvocationSnapshot,
  ActiveInvocationStateSink,
} from '../../runtime/spec/index.js';

type ActiveStateSaveResult =
  | Readonly<{ status: 'fulfilled' }>
  | Readonly<{ status: 'rejected' | 'timed_out' }>;

type OperationSettlement = 'fulfilled' | 'rejected';

const copySnapshot = (snapshot: ActiveInvocationSnapshot): ActiveInvocationSnapshot =>
  Object.freeze({
    invocationId: snapshot.invocationId,
    pin: Object.freeze({ ...snapshot.pin }),
    state: snapshot.state,
    process: Object.freeze({ ...snapshot.process }),
  });

const settleBy = <Value>(
  operation: Promise<Value>,
  deadlineAt: number,
): Promise<Value | 'timed_out'> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve('timed_out'), Math.max(0, deadlineAt - Date.now()));
    timer.unref?.();
    void operation.then((value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });

const settleOperation = (operation: Promise<void>): Promise<OperationSettlement> =>
  operation.then(
    () => 'fulfilled' as const,
    () => 'rejected' as const,
  );

export class ActiveStateLane {
  private appliedTail: Promise<boolean> = Promise.resolve(false);

  constructor(
    private readonly sink: ActiveInvocationStateSink,
    private readonly operationTimeoutMs: number,
  ) {}

  save(snapshot: ActiveInvocationSnapshot, deadlineAt: number): Promise<ActiveStateSaveResult> {
    const copied = copySnapshot(snapshot);
    const operation = this.appliedTail.then(async (wasApplied) =>
      Object.freeze({
        result: await this.dispatchSave(copied, deadlineAt),
        wasApplied,
      }),
    );
    this.appliedTail = operation.then(async ({ result, wasApplied }) => {
      if (result.status === 'fulfilled') return true;
      if (result.status === 'rejected') return wasApplied;
      const lateSettlement = await settleBy(
        result.settlement,
        Date.now() + this.operationTimeoutMs,
      );
      return lateSettlement === 'fulfilled' || wasApplied;
    });
    return operation.then(({ result }) =>
      Object.freeze({
        status: result.status,
      }),
    );
  }

  async remove(invocationId: string, deadlineAt: number): Promise<boolean> {
    const operation = this.appliedTail.then(async (applied) => {
      if (!applied) return Object.freeze({ fulfilled: false, applied: false });
      const controller = new AbortController();
      let remove: Promise<void>;
      try {
        remove = this.sink.remove(invocationId, Object.freeze({ signal: controller.signal }));
      } catch {
        return Object.freeze({ fulfilled: false, applied: false });
      }
      const settlement = settleOperation(remove);
      const result = await settleBy(settlement, deadlineAt);
      if (result === 'timed_out') controller.abort();
      return Object.freeze({
        fulfilled: result === 'fulfilled',
        applied: false,
      });
    });
    this.appliedTail = operation.then((result) => result.applied);
    return (await operation).fulfilled;
  }

  private async dispatchSave(
    snapshot: ActiveInvocationSnapshot,
    deadlineAt: number,
  ): Promise<
    | Readonly<{ status: 'fulfilled' }>
    | Readonly<{ status: 'rejected' }>
    | Readonly<{ status: 'timed_out'; settlement: Promise<OperationSettlement> }>
  > {
    const controller = new AbortController();
    let save: Promise<void>;
    try {
      save = this.sink.save(snapshot, Object.freeze({ signal: controller.signal }));
    } catch {
      return Object.freeze({ status: 'rejected' });
    }
    const settlement = settleOperation(save);
    const result = await settleBy(settlement, deadlineAt);
    if (result !== 'timed_out') return Object.freeze({ status: result });
    controller.abort();
    return Object.freeze({ status: 'timed_out', settlement });
  }
}
