import type { BoundedCommandObservation } from './bounded-command-observation.js';

export interface RunningBoundedCommand {
  readonly completion: Promise<BoundedCommandObservation>;
  readonly timeout: Promise<void>;
  terminateAndReap(): Promise<void>;
}
