import type { ParserFailureReason } from './result-parser/index.js';

// Deliberate temporary narrowing of the real spec DuplexPrimaryFailure (execution-handoff.spec.md §14),
// scoped to what this pre-duplex-coordinator execution port can actually distinguish today. Missing:
// stdout_sink_failed, stderr_sink_failed, result_schema_failed, duplex_operation_timeout, and the full
// ProcessCleanupFailure evidence shape. Remove once the §13/14 duplex coordinator lands; do not treat
// as spec-conformant DuplexPrimaryFailure.
export type InterimDuplexPrimaryFailure =
  | Readonly<{ kind: 'attach_failed' }>
  | Readonly<{ kind: 'stdin_write_failed' }>
  | Readonly<{ kind: 'stdin_end_failed' }>
  | Readonly<{ kind: 'parser_failed'; reason: ParserFailureReason }>
  | Readonly<{ kind: 'process_failed' }>
  | Readonly<{ kind: 'internal' }>;
