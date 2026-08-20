import type { ClaimedInvocationOutput } from './claimed-invocation-output.js';

export type OutputClaimReconciliation =
  | Readonly<{ status: 'absent' }>
  | Readonly<{ status: 'claimed'; session: ClaimedInvocationOutput }>
  | Readonly<{ status: 'unknown'; reason: 'pending' | 'unreconciled' | 'deadline' }>;
