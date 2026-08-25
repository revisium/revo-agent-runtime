import type { AgentExecutionPin } from '../agent-definition/index.js';

export interface AgentEventBase {
  readonly schemaVersion: 'agent-event/v1';
  readonly invocationId: string;
  readonly pin: AgentExecutionPin;
  readonly sequence: number;
  readonly timestamp: string;
}
