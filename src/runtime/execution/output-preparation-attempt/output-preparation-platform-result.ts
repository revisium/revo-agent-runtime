export type OutputPreparationPlatformResult =
  | Readonly<{ status: 'prepared' }>
  | Readonly<{
      status: 'rejected';
      reason:
        | 'scratch_conflict'
        | 'scratch_create_failed'
        | 'scratch_write_failed'
        | 'scratch_flush_failed'
        | 'redaction_sink_create_failed'
        | 'evidence_open_failed';
    }>;
