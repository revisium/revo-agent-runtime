import type {
  ProcessCleanupAttemptOutcome,
  ProcessIdentity,
} from './process-supervision-port/index.js';
import type { RunningExecution } from './running-execution.js';

export type SpawnAndIdentifyResult =
  | Readonly<{
      status: 'identified';
      spawnedAt: number;
      startedAt: string;
      identity: ProcessIdentity;
      activate(): RunningExecution;
      killAndReap(): Promise<ProcessCleanupAttemptOutcome | undefined>;
    }>
  | Readonly<{
      status: 'failed';
      reason: 'spawn_failed' | 'identity_failed';
      cleanupOutcome?: ProcessCleanupAttemptOutcome;
    }>;
