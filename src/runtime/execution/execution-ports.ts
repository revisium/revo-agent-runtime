import type { InvocationTerminalObservation } from './execution-terminal-observation.js';
import type { InvocationInputSnapshot } from './input-snapshot.js';
import type { NormalizedInvocationOutcome } from './normalized-invocation-outcome.js';

export interface InvocationExecutionPorts {
  readonly execution: {
    start(snapshot: InvocationInputSnapshot): Promise<{
      readonly completion: Promise<InvocationTerminalObservation>;
      requestCancellation(): Promise<void>;
    }>;
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
