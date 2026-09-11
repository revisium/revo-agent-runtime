import type { JsonObject } from '../../../contracts/agent-definition.js';
import {
  protocolFailureDetails,
  redactDiagnosticDetails,
  sanitizeDiagnosticDetails,
} from '../../../diagnostics/diagnostic.js';

export { protocolFailureDetails, redactDiagnosticDetails, sanitizeDiagnosticDetails };

type SessionProtocolFailureCode =
  | 'capability_unsupported'
  | 'configuration_stale'
  | 'configuration_value_unsupported'
  | 'interaction_rejected'
  | 'protocol_invalid'
  | 'transport_failed'
  | 'session_closed'
  | 'internal';

export interface SessionProtocolFailure {
  readonly code: SessionProtocolFailureCode;
  readonly message: string;
  readonly details?: JsonObject;
  readonly retryable: boolean;
}
