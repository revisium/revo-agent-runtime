import type { RecoveredProcessInspector } from '../../../../execution/process/port.js';
import { nodeErrorCode } from '../errors.js';
import { windowsProcessNative } from './bindings.js';
import { createWindowsProcessOperations } from './operations.js';
import { waitForWindowsJob } from './wait.js';

export const windowsRecovery: RecoveredProcessInspector = {
  async inspectAndReconcileRecoveredProcess(identity, signal) {
    if (identity.platform !== 'win32' || signal.aborted) return { status: 'inconclusive' };
    let current;
    try {
      const operations = createWindowsProcessOperations(windowsProcessNative);
      current = operations.inspectWindowsIdentity(identity.pid, identity.jobName);
    } catch (error) {
      return { status: nodeErrorCode(error) === 'ESRCH' ? 'absent' : 'inconclusive' };
    }
    try {
      if (current.fingerprint !== identity.fingerprint) return { status: 'identity_mismatch' };
      const job = createWindowsProcessOperations(windowsProcessNative).openWindowsJob(
        identity.jobName,
      );
      if (!job) return { status: 'inconclusive' };
      try {
        if (!job.contains(identity.pid) || signal.aborted) return { status: 'inconclusive' };
        job.terminate();
        const empty = await waitForWindowsJob(job, Date.now() + 2_500, signal);
        return { status: empty ? 'terminated' : 'termination_unconfirmed' };
      } finally {
        job.close();
      }
    } catch {
      return { status: 'inconclusive' };
    }
  },
};
