import type { OutputPreparationMutationRequest } from './output-preparation-mutation-request.js';
import type { OutputPreparationPlatformResult } from './output-preparation-platform-result.js';

export interface OutputPreparationMutationPort {
  prepareClaimedOutput(
    request: OutputPreparationMutationRequest,
  ): Promise<OutputPreparationPlatformResult>;
}
