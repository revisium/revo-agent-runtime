import type { DuplexTerminalObservation } from './duplex-terminal-observation.js';

export const DUPLEX_COORDINATOR_STATE = new WeakMap<
  object,
  {
    readonly deferred: Readonly<{
      readonly promise: Promise<DuplexTerminalObservation>;
      readonly resolve: (value: DuplexTerminalObservation) => void;
    }>;
    committed: boolean;
  }
>();
