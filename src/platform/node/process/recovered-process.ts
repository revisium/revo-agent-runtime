import type {
  ProcessIdentity,
  RecoveredProcessInspector,
  RecoveredProcessReconciliation,
} from '../../../execution/process/port.js';
import {
  nodeProcessGroupSystem,
  type ProcessGroupSystem,
  processTerminationPolicy,
} from './cleanup.js';
import { nodeErrorCode } from './errors.js';
import { inspectLinuxProcessIdentity, type ProcessIdentityInspector } from './identity.js';

const recoveredProcessIsAbsent = (error: unknown): boolean => {
  const code = nodeErrorCode(error);
  return code === 'ENOENT' || code === 'ESRCH';
};

const waitForRecoveredProcessGroupExit = async (
  processGroupId: number,
  deadline: number,
  signal: AbortSignal,
  system: ProcessGroupSystem,
): Promise<boolean> => {
  if (system.groupIsGone(processGroupId)) return true;
  if (system.now() >= deadline || signal.aborted) return false;
  await system.wait(processTerminationPolicy.pollIntervalMs);
  return waitForRecoveredProcessGroupExit(processGroupId, deadline, signal, system);
};

const terminateRecoveredProcessGroup = async (
  processGroupId: number,
  signal: AbortSignal,
  system: ProcessGroupSystem,
): Promise<RecoveredProcessReconciliation> => {
  if (signal.aborted) return Object.freeze({ status: 'inconclusive' });
  if (!system.signal(processGroupId, 'SIGTERM'))
    return Object.freeze({ status: 'termination_unconfirmed' });
  const exitedAfterTerm = await waitForRecoveredProcessGroupExit(
    processGroupId,
    system.now() + processTerminationPolicy.terminationGraceMs,
    signal,
    system,
  );
  if (exitedAfterTerm) return Object.freeze({ status: 'terminated' });
  if (signal.aborted || !system.signal(processGroupId, 'SIGKILL'))
    return Object.freeze({ status: 'termination_unconfirmed' });
  const exitedAfterKill = await waitForRecoveredProcessGroupExit(
    processGroupId,
    system.now() + processTerminationPolicy.postKillConfirmationMs,
    signal,
    system,
  );
  return Object.freeze({
    status: exitedAfterKill ? 'terminated' : 'termination_unconfirmed',
  });
};

export const createNodeRecoveredProcessInspector = (
  inspectIdentity: ProcessIdentityInspector = inspectLinuxProcessIdentity,
  system: ProcessGroupSystem = nodeProcessGroupSystem,
): RecoveredProcessInspector =>
  Object.freeze({
    inspectAndReconcileRecoveredProcess: async (
      persisted: ProcessIdentity,
      signal: AbortSignal,
    ) => {
      let authentic: ProcessIdentity;
      try {
        authentic = await inspectIdentity(persisted.pid);
      } catch (error) {
        return Object.freeze({
          status: recoveredProcessIsAbsent(error) ? 'absent' : 'inconclusive',
        });
      }
      if (authentic.fingerprint !== persisted.fingerprint)
        return Object.freeze({ status: 'identity_mismatch' });
      return terminateRecoveredProcessGroup(authentic.processGroupId, signal, system);
    },
  });

export const nodeRecoveredProcessInspector: RecoveredProcessInspector =
  createNodeRecoveredProcessInspector();
