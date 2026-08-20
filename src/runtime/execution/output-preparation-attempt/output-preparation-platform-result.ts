import type { RedactionChannel } from '../redaction/index.js';
import type { OutputPreparationFileAttestation } from './output-preparation-file-attestation.js';

export type OutputPreparationPlatformResult =
  | Readonly<{
      status: 'prepared';
      attestations: readonly OutputPreparationFileAttestation[];
      frontEnds: Readonly<{
        stdout: RedactionChannel;
        stderr: RedactionChannel;
        rawResponse: RedactionChannel;
      }>;
    }>
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
