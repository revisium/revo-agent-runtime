import type { ProcessCleanupFailureCause } from '../../runtime/execution/index.js';

export type ProcessCleanupOutcome = Readonly<{
  cause: ProcessCleanupFailureCause;
  termSent: boolean;
  killSent: boolean;
  lastKnownGroupState: 'absent' | 'present' | 'unknown';
  leaderReapState: 'confirmed' | 'pending' | 'unknown';
}>;
