export type ParserFailureReason =
  | 'response_empty'
  | 'response_too_large'
  | 'invalid_utf8'
  | 'invalid_json'
  | 'response_not_object'
  | 'frame_malformed'
  | 'frame_overflow'
  | 'duplicate_terminal'
  | 'missing_terminal';
