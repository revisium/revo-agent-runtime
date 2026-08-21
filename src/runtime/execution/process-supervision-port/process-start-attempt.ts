import type { ProcessStartQuiescence } from './process-start-quiescence.js';
import type { ProcessStartResult } from './process-start-result.js';

export interface ProcessStartAttempt {
  readonly invocationId: string;
  readonly settlement: Promise<ProcessStartResult>;
  readonly quiescence: Promise<ProcessStartQuiescence>;
  requestCancellation(reason: 'caller_cancel' | 'manager_shutdown'): void;
}
