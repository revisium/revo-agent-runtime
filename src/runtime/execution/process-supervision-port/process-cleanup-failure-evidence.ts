import type { ProcessCleanupFailureCause } from './process-cleanup-failure-cause.js';

export interface ProcessCleanupFailureEvidence {
  readonly trigger: 'natural_exit';
  readonly cause: ProcessCleanupFailureCause;
  readonly termSent: boolean;
  readonly killSent: boolean;
  readonly lastKnownGroupState: 'absent' | 'present' | 'unknown';
  readonly leaderReapState: 'confirmed' | 'pending' | 'unknown';
}
