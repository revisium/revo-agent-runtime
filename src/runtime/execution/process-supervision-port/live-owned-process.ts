import type { ProcessIdentity } from './process-identity.js';

export interface LiveOwnedProcess {
  readonly completion: Promise<void>;
  readonly identity: ProcessIdentity;
  terminateAndReap(): Promise<void>;
}
