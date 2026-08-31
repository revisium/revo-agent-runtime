import type {
  ActiveInvocationSnapshot,
  ActiveInvocationStateSink,
} from '../../contracts/manager.js';
import type { RecoveredProcessInspector } from '../../execution/process/port.js';
import { ActiveStateLane } from './lane.js';

interface RecoveryAttempt {
  readonly result: Promise<void>;
  readonly quiescence: Promise<void>;
}

type Inspected =
  | {
      readonly status: 'inspected';
      readonly value: Awaited<
        ReturnType<RecoveredProcessInspector['inspectAndReconcileRecoveredProcess']>
      >;
    }
  | { readonly status: 'failed' }
  | { readonly status: 'deadline' };

const inspectUntil = async (
  inspector: RecoveredProcessInspector,
  snapshot: ActiveInvocationSnapshot,
  deadline: number,
  tracked: Promise<unknown>[],
): Promise<Inspected> => {
  const controller = new AbortController();
  const operation = (async () => {
    try {
      return await inspector.inspectAndReconcileRecoveredProcess(
        snapshot.process,
        controller.signal,
      );
    } catch {
      throw new Error('Active-state recovery inspection failed.');
    }
  })();
  tracked.push(operation.catch(() => undefined));
  let timer!: ReturnType<typeof setTimeout>;
  const timeout = new Promise<'deadline'>((resolve) => {
    timer = setTimeout(() => resolve('deadline'), Math.max(0, deadline - Date.now()));
  });
  const outcome = await Promise.race([
    operation.then(
      (value) => ({ status: 'inspected' as const, value }),
      () => ({ status: 'failed' as const }),
    ),
    timeout.then((status) => ({ status })),
  ]);
  clearTimeout(timer);
  if (outcome.status === 'deadline') controller.abort();
  return outcome;
};

export const beginActiveStateRecovery = (
  snapshots: readonly ActiveInvocationSnapshot[],
  sink: ActiveInvocationStateSink,
  inspector: RecoveredProcessInspector,
  operationTimeoutMs: number,
  initializationTimeoutMs: number,
): RecoveryAttempt => {
  const tracked: Promise<unknown>[] = [];
  const lanes: ActiveStateLane[] = [];
  const deadline = Date.now() + initializationTimeoutMs;
  const recoverAt = async (index: number): Promise<void> => {
    const snapshot = snapshots[index];
    if (snapshot === undefined) return;
    const inspected = await inspectUntil(inspector, snapshot, deadline, tracked);
    if (inspected.status !== 'inspected') throw new Error('Active-state recovery failed.');
    if (
      inspected.value.status === 'inconclusive' ||
      inspected.value.status === 'termination_unconfirmed'
    )
      throw new Error('Active-state recovery failed.');
    const lane = new ActiveStateLane(sink, operationTimeoutMs, deadline);
    lanes.push(lane);
    const removal = await lane.remove(snapshot.invocationId);
    if (removal !== 'applied') throw new Error('Active-state recovery failed.');
    if (Date.now() > deadline) throw new Error('Active-state recovery failed.');
    await recoverAt(index + 1);
  };
  const result = recoverAt(0);
  const quiescence = result
    .catch(() => undefined)
    .then(() => Promise.all([...tracked, ...lanes.map((lane) => lane.settled())]))
    .then(() => undefined);
  return Object.freeze({ quiescence, result });
};
