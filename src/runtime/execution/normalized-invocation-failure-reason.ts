export type NormalizedInvocationFailureReason =
  | 'execution_failed'
  | 'response_missing'
  | 'response_empty'
  | 'response_too_large'
  | 'response_invalid_utf8'
  | 'response_invalid_json'
  | 'response_json_primitive'
  | 'response_json_array'
  | 'response_schema_mismatch'
  | 'response_schema_validation_failed'
  | 'output_write_failed';
