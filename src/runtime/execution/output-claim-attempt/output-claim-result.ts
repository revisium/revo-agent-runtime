import type { ClaimedInvocationOutput } from './claimed-invocation-output.js';
import type { OutputClaimGuard } from './output-claim-guard.js';

export type OutputClaimResult =
  | Readonly<{ status: 'claimed'; session: ClaimedInvocationOutput }>
  | Readonly<{
      status: 'rejected';
      reason:
        | 'cancelled_before_dispatch'
        | 'leaf_exists'
        | 'create_failed'
        | 'internal_before_dispatch';
    }>
  | Readonly<{
      status: 'uncertain';
      reason: 'claim_timeout' | 'claim_state_unknown';
      guard: OutputClaimGuard;
    }>;
