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
  readonly retryable: boolean;
}
