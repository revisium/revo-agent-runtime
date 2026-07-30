import type { LiveOwnedProcess } from './live-owned-process.js';
import type { ProcessStartRequest } from './process-start-request.js';

export interface ProcessSupervisionPort {
  start(request: ProcessStartRequest): Promise<LiveOwnedProcess>;
}
