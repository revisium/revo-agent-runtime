import type { OutputClaimQuiescence } from './output-claim-quiescence.js';
import type { OutputClaimResult } from './output-claim-result.js';

export interface OutputClaimAttempt {
  readonly invocationId: string;
  readonly outputDirectory: string;
  readonly settlement: Promise<OutputClaimResult>;
  readonly quiescence: Promise<OutputClaimQuiescence>;
  requestCancellation(): void;
}
