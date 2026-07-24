import type { InvocationInputSnapshot } from './input-snapshot.js';

export interface InvocationExecutionPorts {
  readonly execution: {
    start(snapshot: InvocationInputSnapshot): Promise<{
      readonly completion: Promise<{ readonly status: 'completed' | 'cancelled' }>;
      requestCancellation(): Promise<void>;
    }>;
  };
  readonly clock: {
    now(): number;
    schedule(delayMs: number, callback: () => void): () => void;
  };
  readonly output: {
    prepare(): Promise<void>;
    recordTerminalResult(): Promise<void>;
    recordEvent(): Promise<void>;
  };
}
