export type RawFinalResponseReason =
  | 'response_empty'
  | 'response_too_large'
  | 'duplicate_terminal'
  | 'missing_terminal'
  | 'invalid_utf8'
  | 'invalid_json'
  | 'response_not_object'
  | 'result_schema_failed';
