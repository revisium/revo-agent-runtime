import type { VersionProbeObservation } from './version-probe-observation.js';

export interface RunningVersionProbe {
  readonly completion: Promise<VersionProbeObservation>;
  readonly timeout: Promise<void>;
  terminateAndReap(): Promise<void>;
}
