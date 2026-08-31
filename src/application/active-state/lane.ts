import type {
  ActiveInvocationSnapshot,
  ActiveInvocationStateSink,
} from '../../contracts/manager.js';

export type ActiveStateMutationOutcome =
  | 'applied'
  | 'failed'
  | 'late_applied'
  | 'late_failed'
  | 'unknown';

type SinkMutation = (signal: AbortSignal) => Promise<void>;

type Settlement = 'fulfilled' | 'rejected' | 'deadline';

const settleBy = async (operation: Promise<void>, deadline: number): Promise<Settlement> => {
  const remaining = Math.max(0, deadline - Date.now());
  let timer!: ReturnType<typeof setTimeout>;
  const deadlineReached = new Promise<'deadline'>((resolve) => {
    timer = setTimeout(() => resolve('deadline'), remaining);
  });
  const settlement = await Promise.race([
    operation.then(
      () => 'fulfilled' as const,
      () => 'rejected' as const,
    ),
    deadlineReached,
  ]);
  clearTimeout(timer);
  return settlement;
};

const invokeSink = (mutation: SinkMutation, signal: AbortSignal): Promise<void> => {
  try {
    return Promise.resolve(mutation(signal));
  } catch {
    return Promise.reject(new Error('Active-state sink operation failed.'));
  }
};

export class ActiveStateLane {
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly sink: ActiveInvocationStateSink,
    private readonly operationTimeoutMs: number,
    private readonly absoluteDeadline = Number.POSITIVE_INFINITY,
  ) {}

  save(snapshot: ActiveInvocationSnapshot): Promise<ActiveStateMutationOutcome> {
    return this.enqueue((signal) => this.sink.save(snapshot, { signal }));
  }

  remove(invocationId: string): Promise<ActiveStateMutationOutcome> {
    return this.enqueue((signal) => this.sink.remove(invocationId, { signal }));
  }

  async quiesce(): Promise<'confirmed' | 'unknown'> {
    const settlement = await settleBy(this.tail, this.nextDeadline());
    return settlement === 'fulfilled' ? 'confirmed' : 'unknown';
  }

  settled(): Promise<void> {
    return this.tail;
  }

  private async observe(
    operation: Promise<void>,
    controller: AbortController,
  ): Promise<ActiveStateMutationOutcome> {
    const first = await settleBy(operation, this.nextDeadline());
    if (first === 'fulfilled') return 'applied';
    if (first === 'rejected') return 'failed';

    controller.abort();
    const late = await settleBy(operation, this.nextDeadline());
    if (late === 'fulfilled') return 'late_applied';
    if (late === 'rejected') return 'late_failed';
    return 'unknown';
  }

  private enqueue(mutation: SinkMutation): Promise<ActiveStateMutationOutcome> {
    const started = this.tail.then(() => {
      const controller = new AbortController();
      const operation = invokeSink(mutation, controller.signal);
      return { controller, operation };
    });
    this.tail = started
      .then(({ operation }) => operation)
      .then(
        () => undefined,
        () => undefined,
      );
    return started.then(({ controller, operation }) => this.observe(operation, controller));
  }

  private nextDeadline(): number {
    return Math.min(Date.now() + this.operationTimeoutMs, this.absoluteDeadline);
  }
}
