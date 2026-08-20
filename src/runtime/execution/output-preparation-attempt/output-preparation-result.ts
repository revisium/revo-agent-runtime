import type { PreparedInvocationResources } from './prepared-invocation-resources.js';
import type { TerminalPublicationAuthority } from './terminal-publication-authority.js';

export type OutputPreparationResult =
  | Readonly<{
      status: 'prepared';
      resources: PreparedInvocationResources;
      authority: TerminalPublicationAuthority;
    }>
  | Readonly<{
      status: 'rejected';
      reason:
        | 'cancelled_before_mutation'
        | 'scratch_conflict'
        | 'scratch_create_failed'
        | 'scratch_write_failed'
        | 'scratch_flush_failed'
        | 'redaction_sink_create_failed'
        | 'evidence_open_failed'
        | 'internal_before_mutation';
      authority: TerminalPublicationAuthority;
    }>
  | Readonly<{
      status: 'uncertain';
      reason: 'preparation_timeout' | 'preparation_state_unknown';
      authority: TerminalPublicationAuthority;
    }>;
