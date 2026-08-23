export type AgentInvocationStatus =
  | 'accepted'
  | 'starting'
  | 'running'
  | 'cancelling'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'timed_out';
