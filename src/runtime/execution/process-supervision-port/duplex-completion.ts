import { DuplexCoordinatorRegistration } from './duplex-coordinator-registration.js';
import { DUPLEX_COORDINATOR_STATE } from './duplex-coordinator-state.js';
import type { DuplexTerminalObservation } from './duplex-terminal-observation.js';

export const duplexCompletion = (
  coordinator: unknown,
): Promise<DuplexTerminalObservation> | undefined => {
  if (!DuplexCoordinatorRegistration.isAuthentic(coordinator)) return undefined;
  return DUPLEX_COORDINATOR_STATE.get(coordinator)?.deferred.promise;
};
