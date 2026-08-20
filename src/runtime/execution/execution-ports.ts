import type { InvocationTerminalObservation } from './execution-terminal-observation.js';
import type { InvocationInputSnapshot } from './input-snapshot.js';
import type { NormalizedInvocationOutcome } from './normalized-invocation-outcome.js';
import type { PreparedLaunch } from './prepared-launch.js';
import type { WorkspaceAdmissionResult } from './workspace-admission-result.js';

export interface InvocationExecutionPorts {
  readonly execution: {
    start(
      snapshot: InvocationInputSnapshot,
      preparedLaunch: PreparedLaunch,
    ): Promise<{
      readonly completion: Promise<InvocationTerminalObservation>;
      requestCancellation(): Promise<void>;
    }>;
  };
  readonly workspace: {
    admit(path: string): Promise<WorkspaceAdmissionResult>;
  };
  readonly clock: {
    now(): number;
    schedule(delayMs: number, callback: () => void): () => void;
  };
  readonly output: {
    prepare(): Promise<void>;
    recordTerminalResult(outcome: NormalizedInvocationOutcome): Promise<void>;
    recordEvent(): Promise<void>;
  };
}
