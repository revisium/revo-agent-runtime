export type DuplexOperation =
  | 'attach'
  | 'stdin_write'
  | 'stdin_end'
  | 'stdout_write'
  | 'stdout_end'
  | 'stderr_write'
  | 'stderr_end'
  | 'protocol_write'
  | 'protocol_end'
  | 'parser_finish';
