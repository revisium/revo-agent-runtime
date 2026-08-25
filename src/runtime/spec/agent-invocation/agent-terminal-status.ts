import type { AgentInvocationStatus } from './agent-invocation-status.js';

export type AgentTerminalStatus = Extract<
  AgentInvocationStatus,
  'succeeded' | 'failed' | 'cancelled' | 'timed_out'
>;
