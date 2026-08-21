import type { AgentInvocationSucceeded } from './agent-invocation-succeeded.js';

// Failed, cancelled, and timed-out variants are deferred pending an AgentFault widening decision.
export type AgentInvocationResult = AgentInvocationSucceeded;
