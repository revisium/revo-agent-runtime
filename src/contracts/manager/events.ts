import type { AgentRef } from '../agent-definition.js';
import type { AgentExecutionPin } from './core.js';

export interface AgentEvent {
  readonly schemaVersion: 'agent-event/v1';
  readonly invocationId: string;
  readonly pin: AgentExecutionPin;
  readonly sequence: number;
  readonly timestamp: string;
  readonly type:
    | 'invocation.accepted'
    | 'invocation.started'
    | 'invocation.cancelling'
    | 'invocation.finished';
}

export interface AgentEventFilter {
  readonly invocationId?: string;
  readonly agent?: AgentRef;
  readonly types?: readonly AgentEvent['type'][];
}

export type AgentEventListener = (event: AgentEvent) => void;
export type Unsubscribe = () => void;
