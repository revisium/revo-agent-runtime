import type { InvocationTerminalObservation } from './execution-terminal-observation.js';
import type { ProcessCleanupAttemptOutcome } from './process-supervision-port/index.js';

export interface RunningExecution {
  readonly spawnedAt: number;
  readonly completion: Promise<InvocationTerminalObservation>;
  requestCancellation(): Promise<ProcessCleanupAttemptOutcome | undefined>;
}
