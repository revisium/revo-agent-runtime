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

const preservedCategoryFor = (status: string | undefined): RecoveryFailureCategory =>
  status === 'identity_mismatch'
    ? 'identity_conflict'
    : status === 'termination_unconfirmed'
      ? 'termination_unconfirmed'
      : 'inspection_inconclusive';

export const reconcileRecoveredRows = async (
  snapshots: readonly ActiveInvocationSnapshot[],
  registry: SealedAgentRegistry,
  execution: RecoveryExecutionPort,
  activeStateSink: ActiveInvocationStateSink,
  operationTimeoutMs: number,
  initializationDeadlineAt: number,
  isClosing: () => boolean,
): Promise<readonly RecoveredRowFailure[]> => {
  const failures: RecoveredRowFailure[] = [];
  const ordered = [...snapshots].toSorted((left, right) =>
    left.invocationId < right.invocationId ? -1 : left.invocationId > right.invocationId ? 1 : 0,
  );
  const fail = (invocationId: string, category: RecoveryFailureCategory): void => {
    failures.push(Object.freeze({ invocationId, category }));
  };

  for (const row of ordered) {
    if (isClosing()) {
      fail(row.invocationId, 'manager_closing');
      continue;
    }
    if (Date.now() >= initializationDeadlineAt) {
      fail(row.invocationId, 'deadline_exceeded');
      continue;
    }

    const definition = registry.getDefinition(
      Object.freeze({ id: row.pin.agentId, version: row.pin.agentVersion }),
    );
    if (definition === undefined) {
      fail(row.invocationId, 'pin_unknown');
      continue;
    }
    if (definition.definitionDigest !== row.pin.definitionDigest) {
      fail(row.invocationId, 'pin_digest_mismatch');
      continue;
    }

    let outcome:
      | Awaited<ReturnType<RecoveryExecutionPort['inspectAndReconcileRecoveredProcess']>>
      | undefined;
    try {
      // oxlint-disable-next-line no-await-in-loop -- recovery is specification-mandated FIFO.
      outcome = await execution.inspectAndReconcileRecoveredProcess(
        row.process.pid,
        row.process.fingerprint,
        Math.min(Date.now() + operationTimeoutMs, initializationDeadlineAt),
      );
    } catch {
      fail(row.invocationId, 'inspection_inconclusive');
      continue;
    }

    const status = typeof outcome?.status === 'string' ? outcome.status : undefined;
    if (status !== 'absent' && status !== 'terminated') {
      fail(row.invocationId, preservedCategoryFor(status));
      continue;
    }

    const removeDeadlineAt = Math.min(Date.now() + operationTimeoutMs, initializationDeadlineAt);
    if (removeDeadlineAt <= Date.now()) {
      fail(row.invocationId, 'deadline_exceeded');
      continue;
    }
    const lane = ActiveStateLane.forExternallyAppliedRow(activeStateSink, operationTimeoutMs);
    try {
      // oxlint-disable-next-line no-await-in-loop -- recovery is specification-mandated FIFO.
      if (!(await lane.remove(row.invocationId, removeDeadlineAt)))
        fail(row.invocationId, 'sink_failed');
    } catch {
      fail(row.invocationId, 'sink_failed');
    }
  }
  return Object.freeze(failures);
};
