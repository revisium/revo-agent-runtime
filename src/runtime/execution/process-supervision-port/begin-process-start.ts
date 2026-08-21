import type { ProcessStartAttempt } from './process-start-attempt.js';
import { PROCESS_START_BEGINNERS } from './process-start-beginners.js';

export const beginProcessStart = (attempt: ProcessStartAttempt, dispatch: () => void): void => {
  PROCESS_START_BEGINNERS.get(attempt)?.(dispatch);
};
