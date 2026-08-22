import { DuplexCoordinatorRegistration } from './duplex-coordinator-registration.js';
import { DUPLEX_COORDINATOR_STATE } from './duplex-coordinator-state.js';
import type { DuplexTerminalObservation } from './duplex-terminal-observation.js';

export const submitDuplexCandidate = (
  coordinator: unknown,
  candidate: DuplexTerminalObservation,
): boolean => {
  if (!DuplexCoordinatorRegistration.isAuthentic(coordinator)) return false;
  const state = DUPLEX_COORDINATOR_STATE.get(coordinator);
  if (state === undefined || state.committed) return false;
  state.committed = true;
  state.deferred.resolve(candidate);
  return true;
};
