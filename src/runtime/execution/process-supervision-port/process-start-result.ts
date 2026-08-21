import type { PausedProcessIo } from './paused-process-io.js';
import type { SpawnAcceptedProcess } from './spawn-accepted-process.js';

export type ProcessStartResult =
  | Readonly<{ status: 'spawn_accepted'; process: SpawnAcceptedProcess; io: PausedProcessIo }>
  | Readonly<{
      status: 'rejected';
      reason:
        | 'cancelled_before_spawn'
        | 'manager_shutdown_before_spawn'
        | 'spawn_failed'
        | 'internal_invariant_violation';
    }>;
