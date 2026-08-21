import type { ProcessStartResult } from './process-start-result.js';

export const PROCESS_START_SETTLERS = new WeakMap<
  object,
  (
    outcome: Readonly<{ status: 'accepted'; spawnedAt: number }> | Readonly<{ status: 'failed' }>,
  ) => ProcessStartResult | undefined
>();
