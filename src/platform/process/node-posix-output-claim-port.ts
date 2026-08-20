import { mkdir } from 'node:fs/promises';

import type {
  OutputClaimExclusiveCreatePort,
  OutputClaimExclusiveCreateRequest,
  OutputClaimPlatformResult,
} from '../../runtime/execution/index.js';
import { nodePosixPathAdmission } from './node-posix-path-admission.js';

const created: OutputClaimPlatformResult = Object.freeze({ status: 'created' });
const leafExists: OutputClaimPlatformResult = Object.freeze({ status: 'leaf_exists' });
const createFailed: OutputClaimPlatformResult = Object.freeze({ status: 'create_failed' });

const isDispatchable = (request: OutputClaimExclusiveCreateRequest): boolean =>
  typeof request.outputDirectory === 'string' &&
  typeof request.markSyscallDispatched === 'function' &&
  process.platform === 'linux' &&
  !nodePosixPathAdmission.isInvalidOutputLeafPath(request.outputDirectory);

export class NodePosixOutputClaimPort implements OutputClaimExclusiveCreatePort {
  async createExclusiveOutputDirectory(
    request: OutputClaimExclusiveCreateRequest,
  ): Promise<OutputClaimPlatformResult> {
    try {
      if (!isDispatchable(request)) return createFailed;
      // Keep this immediately before mkdir so a dispatched syscall cannot be
      // misclassified as undispatched by the claim attempt state machine.
      request.markSyscallDispatched();
      await mkdir(request.outputDirectory);
      return created;
    } catch (error: unknown) {
      return nodePosixPathAdmission.isExistingPathError(error) ? leafExists : createFailed;
    }
  }
}
