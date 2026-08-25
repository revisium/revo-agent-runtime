import type { AgentRef } from '../agent-definition/index.js';
import type { AgentEvent } from './agent-event.js';

export interface AgentEventFilter {
  readonly invocationId?: string;
  readonly agent?: AgentRef;
  readonly types?: readonly AgentEvent['type'][];
}

export type Unsubscribe = () => void;
export type AgentEventListener = (event: AgentEvent) => void;
