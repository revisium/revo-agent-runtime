import { stat } from 'node:fs/promises';
import { posix } from 'node:path';

import type { WorkspaceAdmissionResult } from '../../runtime/execution/index.js';

export class NodePosixWorkspacePort {
  async admit(path: string): Promise<WorkspaceAdmissionResult> {
    if (process.platform !== 'linux')
      return Object.freeze({ status: 'rejected', reason: 'unsupported_platform' });
    if (
      path.length === 0 ||
      path.length > 4_096 ||
      new TextEncoder().encode(path).byteLength > 4_096 ||
      path.includes('\0') ||
      !path.startsWith('/') ||
      path !== posix.normalize(path)
    )
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
