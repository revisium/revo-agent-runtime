import type { AgentInvocationResult } from '../agent-invocation-result/index.js';
import type { AgentInvocationSnapshot } from './agent-invocation-snapshot.js';

export type AgentResultLookup =
  | Readonly<{ state: 'running'; invocation: AgentInvocationSnapshot }>
  | Readonly<{ state: 'completed'; result: AgentInvocationResult }>
  | Readonly<{ state: 'unknown' }>;

export type CancelInvocationResult =
  | Readonly<{ state: 'requested' }>
  | Readonly<{ state: 'already_completed'; result: AgentInvocationResult }>
  | Readonly<{ state: 'unknown' }>;
