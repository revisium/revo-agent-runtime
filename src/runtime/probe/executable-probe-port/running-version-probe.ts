import type { VersionProbeObservation } from './version-probe-observation.js';

type ProcessCleanupAttemptOutcome = Readonly<{
  readonly cause:
    | 'inspection_timeout'
    | 'inspection_rejected'
    | 'group_state_unknown'
    | 'termination_rejected'
    | 'post_kill_confirmation_rejected'
    | 'group_still_live'
    | 'post_kill_confirmation_timeout'
    | 'leader_reap_timeout'
    | 'leader_reap_rejected';
  readonly termSent: boolean;
  readonly killSent: boolean;
  readonly lastKnownGroupState: 'absent' | 'present' | 'unknown';
  readonly leaderReapState: 'confirmed' | 'pending' | 'unknown';
}>;

export interface RunningVersionProbe {
  readonly completion: Promise<VersionProbeObservation>;
  readonly timeout: Promise<void>;
  terminateAndReap(): Promise<ProcessCleanupAttemptOutcome | undefined>;
}
