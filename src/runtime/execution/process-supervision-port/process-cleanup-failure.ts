import type { ProcessCleanupFailureCause } from './process-cleanup-failure-cause.js';
import type { ProcessCleanupFailureEvidence } from './process-cleanup-failure-evidence.js';

export interface ProcessCleanupFailure {
  readonly kind: 'process_cleanup_failed';
  readonly cause: ProcessCleanupFailureCause;
  readonly evidence: ProcessCleanupFailureEvidence;
}
