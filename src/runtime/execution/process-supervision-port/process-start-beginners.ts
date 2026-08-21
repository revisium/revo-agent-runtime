import type { ProcessStartAttempt } from './process-start-attempt.js';

export const PROCESS_START_BEGINNERS = new WeakMap<
  ProcessStartAttempt,
  (dispatch: () => void) => void
>();
