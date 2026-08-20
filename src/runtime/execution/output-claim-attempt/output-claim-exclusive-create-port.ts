import type { OutputClaimExclusiveCreateRequest } from './output-claim-exclusive-create-request.js';
import type { OutputClaimPlatformResult } from './output-claim-platform-result.js';

export interface OutputClaimExclusiveCreatePort {
  createExclusiveOutputDirectory(
    request: OutputClaimExclusiveCreateRequest,
  ): Promise<OutputClaimPlatformResult>;
}
