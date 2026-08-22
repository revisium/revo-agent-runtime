import type { AgentInvocationResult } from '../spec/index.js';
import type { NormalizedInvocationOutcome } from './normalized-invocation-outcome.js';

export interface FinalizedInvocationSettlement {
  readonly outcome: NormalizedInvocationOutcome;
  readonly delivered: AgentInvocationResult;
}
