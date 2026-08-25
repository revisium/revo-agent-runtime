import type { AgentExecutionPin } from '../agent-definition/index.js';

export interface ActiveStateOperationContext {
  readonly signal: AbortSignal;
}

export interface ActiveProcessIdentity {
  readonly pid: number;
  readonly processGroupId: number;
  readonly fingerprint: string;
  readonly startedAt: string;
}

export type ActiveInvocationState = 'running' | 'cancelling';

export interface ActiveInvocationSnapshot {
  readonly invocationId: string;
  readonly pin: AgentExecutionPin;
  readonly state: ActiveInvocationState;
  readonly process: ActiveProcessIdentity;
}

export interface ActiveInvocationStateSink {
  save(snapshot: ActiveInvocationSnapshot, context: ActiveStateOperationContext): Promise<void>;
  remove(invocationId: string, context: ActiveStateOperationContext): Promise<void>;
}
