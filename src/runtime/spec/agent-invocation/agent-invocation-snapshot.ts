import type { AgentExecutionPin } from '../agent-definition/index.js';
import type { JsonObject } from '../json/index.js';
import type { AgentInvocationStatus } from './agent-invocation-status.js';

export interface AgentInvocationSnapshot {
  readonly invocationId: string;
  readonly pin: AgentExecutionPin;
  readonly status: AgentInvocationStatus;
  readonly metadata?: JsonObject;
  readonly acceptedAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly outputDirectory: string;
}
