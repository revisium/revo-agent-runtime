import type {
  ActiveInvocationSnapshot,
  ActiveInvocationStateSink,
} from '../../../src/contracts/manager.js';

export const noOpActiveStateSink: ActiveInvocationStateSink = Object.freeze({
  remove: async () => undefined,
  save: async () => undefined,
});

interface HeldActiveStateMutation {
  fail(): void;
  succeed(): void;
}

type MutationKind = 'remove' | 'save';

interface PlannedMutation {
  readonly kind: MutationKind;
  readonly settlement: PromiseWithResolvers<void>;
  failOnStart: boolean;
}

export interface ActiveStateStory {
  readonly sink: ActiveInvocationStateSink;
  failNext(kind: MutationKind): void;
  holdNext(kind: MutationKind): HeldActiveStateMutation;
  operations(): readonly string[];
  signals(): readonly AbortSignal[];
  snapshots(): readonly ActiveInvocationSnapshot[];
  waitUntilRecorded(count: number): Promise<void>;
}

export const activeStateStory = (): ActiveStateStory => {
  const plans: PlannedMutation[] = [];
  const operations: string[] = [];
  const signals: AbortSignal[] = [];
  const snapshots: ActiveInvocationSnapshot[] = [];
  const operationWaiters: Array<() => void> = [];

  const perform = (kind: MutationKind): Promise<void> => {
    const plan = plans[0];
    if (plan?.kind !== kind) return Promise.resolve();
    plans.shift();
    if (plan.failOnStart) plan.settlement.reject(new Error('consumer sink failed'));
    return plan.settlement.promise;
  };

  const plan = (kind: MutationKind): PlannedMutation => {
    const mutation = {
      failOnStart: false,
      kind,
      settlement: Promise.withResolvers<void>(),
    };
    plans.push(mutation);
    return mutation;
  };

  const waitUntilRecorded = async (count: number): Promise<void> => {
    if (operations.length >= count) return;
    await new Promise<void>((resolve) => operationWaiters.push(resolve));
    return waitUntilRecorded(count);
  };

  return {
    sink: {
      remove: (invocationId, context) => {
        operations.push(`remove:${invocationId}`);
        operationWaiters.splice(0).forEach((resolve) => resolve());
        signals.push(context.signal);
        return perform('remove');
      },
      save: (snapshot, context) => {
        operations.push(`save:${snapshot.state}`);
        operationWaiters.splice(0).forEach((resolve) => resolve());
        snapshots.push(snapshot);
        signals.push(context.signal);
        return perform('save');
      },
    },
    failNext: (kind) => {
      const mutation = plan(kind);
      mutation.failOnStart = true;
    },
    holdNext: (kind) => {
      const mutation = plan(kind);
      return {
        fail: () => mutation.settlement.reject(new Error('consumer sink failed')),
        succeed: () => mutation.settlement.resolve(),
      };
    },
    operations: () => [...operations],
    signals: () => [...signals],
    snapshots: () => [...snapshots],
    waitUntilRecorded,
  };
};
