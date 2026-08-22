import type { BoundedRawResponseEvidence } from './bounded-raw-response-evidence.js';

export interface RawResponseCapture {
  record(bytes: Uint8Array): void;
  take(): BoundedRawResponseEvidence;
  dispose(): void;
}
