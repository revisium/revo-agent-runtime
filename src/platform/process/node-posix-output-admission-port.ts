import { lstat, stat } from 'node:fs/promises';
import { posix } from 'node:path';

import type { InvocationExecutionPorts } from '../../runtime/execution/index.js';
import { nodePosixPathAdmission } from './node-posix-path-admission.js';

type OutputAdmissionRequest = Parameters<InvocationExecutionPorts['output']['admit']>[0];
type OutputAdmissionResult = Awaited<ReturnType<InvocationExecutionPorts['output']['admit']>>;

const invalidOutputLeaf = (path: string): boolean =>
  nodePosixPathAdmission.isInvalidNormalizedAbsolutePosixPath(path) || path === '/';

export class NodePosixOutputAdmissionPort {
  async admit(request: OutputAdmissionRequest): Promise<OutputAdmissionResult> {
    if (process.platform !== 'linux')
      return Object.freeze({ status: 'rejected', reason: 'unsupported_platform' });
    if (invalidOutputLeaf(request.outputDirectory))
      return Object.freeze({ status: 'rejected', reason: 'invalid_path' });
    const parent = posix.dirname(request.outputDirectory);
    try {
      if (!(await stat(parent)).isDirectory())
        return Object.freeze({ status: 'rejected', reason: 'parent_not_directory' });
    } catch (error: unknown) {
      return Object.freeze({
        status: 'rejected',
        reason: nodePosixPathAdmission.isMissingPathError(error)
          ? 'missing_parent'
          : 'inspection_failed',
      });
    }
    try {
      await lstat(request.outputDirectory);
      return Object.freeze({ status: 'rejected', reason: 'leaf_exists' });
    } catch (error: unknown) {
      if (!nodePosixPathAdmission.isMissingPathError(error))
        return Object.freeze({ status: 'rejected', reason: 'inspection_failed' });
    }
    return Object.freeze({
      status: 'admitted',
      plan: Object.freeze({
        invocationId: request.invocationId,
        outputDirectory: request.outputDirectory,
        needsPromptFile: request.needsPromptFile,
        needsResultSchemaFile: request.needsResultSchemaFile,
      }),
    });
  }
}
