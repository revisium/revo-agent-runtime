import type { ProcessStartQuiescence } from './process-start-quiescence.js';

export const PROCESS_START_QUIESCENCE_SETTLERS = new WeakMap<
  object,
  (quiescence: ProcessStartQuiescence) => void
>();
