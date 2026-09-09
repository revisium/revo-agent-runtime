import type {
  ProcessGroupIdentity,
  ProcessIdentity,
  ProcessIdentityInspector,
  RecoveredProcessInspector,
  RecoveredProcessReconciliation,
} from '../contracts.js';
import { nodeErrorCode } from '../resources.js';
import {
  nodeProcessGroupSystem,
  type ProcessGroupSystem,
  processTerminationPolicy,
} from './cleanup.js';

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
  system.signal(processGroupId, 'SIGTERM');
  const exitedAfterTerm = await waitForRecoveredProcessGroupExit(
    processGroupId,
    system.now() + processTerminationPolicy.terminationGraceMs,
    signal,
    system,
  );
  if (exitedAfterTerm) return Object.freeze({ status: 'terminated' });
  if (signal.aborted) return Object.freeze({ status: 'termination_unconfirmed' });
  system.signal(processGroupId, 'SIGKILL');
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

export const createPosixRecovery = (
  inspectIdentity: ProcessIdentityInspector,
  system: ProcessGroupSystem = nodeProcessGroupSystem,
): RecoveredProcessInspector =>
  Object.freeze({
    inspectAndReconcileRecoveredProcess: async (
      persisted: ProcessIdentity,
      signal: AbortSignal,
    ) => {
      if (persisted.platform === 'win32') return Object.freeze({ status: 'inconclusive' });
      let authentic: ProcessGroupIdentity;
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
