import type { RecoveredProcessInspector } from '../contracts.js';
import { processPlatform } from './platform.js';
export { createPosixRecovery as createNodeRecoveredProcessInspector } from './posix-recovery.js';

export const nodeRecoveredProcessInspector: RecoveredProcessInspector = {
  async inspectAndReconcileRecoveredProcess(identity, signal) {
    const platform = await processPlatform();
    if ((identity.platform ?? 'linux') !== platform.name) return { status: 'inconclusive' };
    return platform.recover.inspectAndReconcileRecoveredProcess(identity, signal);
  },
};
