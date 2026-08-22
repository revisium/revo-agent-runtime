import type { AgentInvocationCancelled } from './agent-invocation-cancelled.js';
import type { AgentInvocationFailed } from './agent-invocation-failed.js';
import type { AgentInvocationSucceeded } from './agent-invocation-succeeded.js';
import type { AgentInvocationTimedOut } from './agent-invocation-timed-out.js';

export type AgentInvocationResult =
  | AgentInvocationSucceeded
  | AgentInvocationFailed
  | AgentInvocationCancelled
  | AgentInvocationTimedOut;
