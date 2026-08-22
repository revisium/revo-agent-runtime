import type { DuplexOperation } from './process-supervision-port/duplex-operation.js';
import type { ProcessCleanupFailure } from './process-supervision-port/process-cleanup-failure.js';
import type { ParserFailureReason } from './result-parser/index.js';

// Deliberate temporary narrowing of the real spec DuplexPrimaryFailure (execution-handoff.spec.md §14),
// retaining this pre-duplex-coordinator execution port's internal fallback until the full §14
// coordinator owns every terminal signal source. Remove once the §13/14 duplex coordinator lands; do
// not treat as spec-conformant DuplexPrimaryFailure.
export type InterimDuplexPrimaryFailure =
  | Readonly<{ kind: 'attach_failed' }>
  | Readonly<{ kind: 'stdin_write_failed' }>
  | Readonly<{ kind: 'stdin_end_failed' }>
  | Readonly<{ kind: 'stdout_sink_failed' }>
  | Readonly<{ kind: 'stderr_sink_failed' }>
  | Readonly<{ kind: 'protocol_sink_failed' }>
  | Readonly<{ kind: 'parser_failed'; reason: ParserFailureReason }>
  | Readonly<{ kind: 'result_schema_failed' }>
  | Readonly<{ kind: 'process_failed' }>
  | Readonly<{ kind: 'duplex_operation_timeout'; operation: DuplexOperation }>
  | ProcessCleanupFailure
  | Readonly<{ kind: 'internal' }>;
