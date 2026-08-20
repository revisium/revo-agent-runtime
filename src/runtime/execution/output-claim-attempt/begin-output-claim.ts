import type { OutputClaimAttempt } from './output-claim-attempt.js';
import { OUTPUT_CLAIM_BEGINNERS } from './output-claim-beginners.js';

export const beginOutputClaim = (attempt: OutputClaimAttempt): void => {
  OUTPUT_CLAIM_BEGINNERS.get(attempt)?.();
};
