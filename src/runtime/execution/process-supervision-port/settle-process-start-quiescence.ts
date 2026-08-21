import { PROCESS_START_QUIESCENCE_SETTLERS } from './process-start-quiescence-settlers.js';
import type { ProcessStartQuiescence } from './process-start-quiescence.js';

export const settleProcessStartQuiescence = (
  attempt: object,
  quiescence: ProcessStartQuiescence,
): void => {
  PROCESS_START_QUIESCENCE_SETTLERS.get(attempt)?.(quiescence);
};
