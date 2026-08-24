import type { ProcessCleanupAttemptOutcome } from './process-cleanup-attempt-outcome.js';

export interface ProcessCleanupFailureEvidence extends ProcessCleanupAttemptOutcome {
  readonly trigger: 'natural_exit';
}
