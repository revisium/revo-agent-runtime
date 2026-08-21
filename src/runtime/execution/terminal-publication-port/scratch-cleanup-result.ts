export type ScratchCleanupResult =
  | Readonly<{ status: 'cleaned' }>
  | Readonly<{ status: 'absent' }>
  | Readonly<{ status: 'failed'; reason: 'cleanup_failed' }>;
