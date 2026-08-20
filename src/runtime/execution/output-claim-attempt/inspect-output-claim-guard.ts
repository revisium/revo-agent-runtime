import { OutputClaimGuard } from './output-claim-guard.js';
import type { OutputClaimReconciliation } from './output-claim-reconciliation.js';

export const inspectOutputClaimGuard = (guard: unknown): OutputClaimReconciliation =>
  OutputClaimGuard.inspect(guard);
