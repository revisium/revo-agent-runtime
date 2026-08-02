import type { ProcessExitObservation } from './process-exit-observation.js';
import type { ProcessIdentity } from './process-identity.js';

export interface LiveOwnedProcess {
  readonly completion: Promise<ProcessExitObservation>;
  readonly identity: ProcessIdentity;
  terminateAndReap(): Promise<void>;
}
