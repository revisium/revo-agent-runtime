import { stat } from 'node:fs/promises';

import type { WorkspaceAdmissionResult } from '../../runtime/execution/index.js';
import { nodePosixPathAdmission } from './node-posix-path-admission.js';

export class NodePosixWorkspacePort {
  async admit(path: string): Promise<WorkspaceAdmissionResult> {
    if (process.platform !== 'linux')
      return Object.freeze({ status: 'rejected', reason: 'unsupported_platform' });
    if (nodePosixPathAdmission.isInvalidNormalizedAbsolutePosixPath(path))
      return Object.freeze({ status: 'rejected', reason: 'invalid_path' });
    try {
      if (!(await stat(path)).isDirectory())
        return Object.freeze({ status: 'rejected', reason: 'not_directory' });
      return Object.freeze({ status: 'admitted', directory: path });
    } catch {
      return Object.freeze({ status: 'rejected', reason: 'missing' });
    }
  }
}
