import type { InvocationExecutionPorts } from '../../runtime/execution/index.js';
import { SealedAgentRegistry } from '../../runtime/registry/index.js';
import type {
  ActiveInvocationSnapshot,
  ActiveInvocationStateSink,
} from '../../runtime/spec/index.js';
import { ActiveStateLane } from './active-state-lane.js';
import type { RecoveredRowFailure } from './recovered-row-failure.js';
type RecoveryFailureCategory = RecoveredRowFailure['category'];

type RecoveryExecutionPort = InvocationExecutionPorts['execution'];

const compareStrings = (left: string, right: string): number => {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

const preservedCategoryFor = (status: string | undefined): RecoveryFailureCategory => {
  if (status === 'identity_mismatch') return 'identity_conflict';
  if (status === 'termination_unconfirmed') return 'termination_unconfirmed';
  return 'inspection_inconclusive';
};

const reconcileRow = async (
  row: ActiveInvocationSnapshot,
  registry: SealedAgentRegistry,
  execution: RecoveryExecutionPort,
  activeStateSink: ActiveInvocationStateSink,
  operationTimeoutMs: number,
  initializationDeadlineAt: number,
  isClosing: () => boolean,
): Promise<RecoveryFailureCategory | undefined> => {
  if (isClosing()) return 'manager_closing';
  if (Date.now() >= initializationDeadlineAt) return 'deadline_exceeded';

  const definition = registry.getDefinition(
    Object.freeze({ id: row.pin.agentId, version: row.pin.agentVersion }),
  );
  if (definition === undefined) return 'pin_unknown';
  if (definition.definitionDigest !== row.pin.definitionDigest) return 'pin_digest_mismatch';

  let outcome:
    | Awaited<ReturnType<RecoveryExecutionPort['inspectAndReconcileRecoveredProcess']>>
    | undefined;
  try {
    outcome = await execution.inspectAndReconcileRecoveredProcess(
      row.process.pid,
      row.process.fingerprint,
      Math.min(Date.now() + operationTimeoutMs, initializationDeadlineAt),
    );
  } catch {
    return 'inspection_inconclusive';
  }

  const status = typeof outcome?.status === 'string' ? outcome.status : undefined;
  if (status !== 'absent' && status !== 'terminated') return preservedCategoryFor(status);

  const removeDeadlineAt = Math.min(Date.now() + operationTimeoutMs, initializationDeadlineAt);
  if (removeDeadlineAt <= Date.now()) return 'deadline_exceeded';

  const lane = ActiveStateLane.forExternallyAppliedRow(activeStateSink, operationTimeoutMs);
  try {
    return (await lane.remove(row.invocationId, removeDeadlineAt)) ? undefined : 'sink_failed';
  } catch {
    return 'sink_failed';
  }
};

export const reconcileRecoveredRows = async (
  snapshots: readonly ActiveInvocationSnapshot[],
  registry: SealedAgentRegistry,
  execution: RecoveryExecutionPort,
  activeStateSink: ActiveInvocationStateSink,
  operationTimeoutMs: number,
  initializationDeadlineAt: number,
  isClosing: () => boolean,
): Promise<readonly RecoveredRowFailure[]> => {
  const ordered = [...snapshots].toSorted((left, right) =>
    compareStrings(left.invocationId, right.invocationId),
  );
  const failures: RecoveredRowFailure[] = [];

  for (const row of ordered) {
    // oxlint-disable-next-line no-await-in-loop -- recovery is specification-mandated FIFO.
    const category = await reconcileRow(
      row,
      registry,
      execution,
      activeStateSink,
      operationTimeoutMs,
      initializationDeadlineAt,
      isClosing,
    );
    if (category !== undefined)
      failures.push(Object.freeze({ invocationId: row.invocationId, category }));
  }
  return Object.freeze(failures);
};
