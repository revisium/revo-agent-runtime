import type { ProtocolObservationResult } from './protocol-observation-result.js';

export interface AttachedProtocolSession {
  finishAfterProtocolOutputEnd(): Promise<ProtocolObservationResult>;
  requestCancellation(): Promise<'sent' | 'unsupported' | 'failed'>;
  closeInput(): Promise<void>;
  dispose(): void;
}
