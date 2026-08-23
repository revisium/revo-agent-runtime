export type CancellationCommitOutcome =
  | Readonly<{ status: 'committed'; completion: Promise<void> }>
  | Readonly<{ status: 'too_late' }>;
