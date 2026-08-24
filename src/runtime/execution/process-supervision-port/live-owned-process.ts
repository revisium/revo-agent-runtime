import type { ProcessCleanupAttemptOutcome } from './process-cleanup-attempt-outcome.js';
import type { ProcessExitObservation } from './process-exit-observation.js';
import type { ProcessIdentity } from './process-identity.js';
import type { ProcessInputSink } from './process-input-sink.js';

export interface LiveOwnedProcess {
  readonly spawnedAt: number;
  readonly completion: Promise<ProcessExitObservation>;
  readonly identity: ProcessIdentity;
  readonly stdin: ProcessInputSink;
  terminateAndReap(): Promise<ProcessCleanupAttemptOutcome | undefined>;
}
