import type { AgentEventBase } from './agent-event-base.js';

export type AgentEvent =
  | (AgentEventBase & Readonly<{ type: 'invocation.accepted' }>)
  | (AgentEventBase & Readonly<{ type: 'invocation.started' }>)
  | (AgentEventBase & Readonly<{ type: 'invocation.exited' }>)
  | (AgentEventBase & Readonly<{ type: 'invocation.finished' }>);
