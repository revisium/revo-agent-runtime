type RecoveryFailureCategory =
  | 'pin_unknown'
  | 'pin_digest_mismatch'
  | 'identity_conflict'
  | 'inspection_inconclusive'
  | 'termination_unconfirmed'
  | 'sink_failed'
  | 'deadline_exceeded'
  | 'manager_closing'
  | 'platform_unsupported';

export type RecoveredRowFailure = Readonly<{
  invocationId: string;
  category: RecoveryFailureCategory;
}>;
