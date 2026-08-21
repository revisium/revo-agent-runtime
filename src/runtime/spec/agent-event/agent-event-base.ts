export interface AgentEventBase {
  readonly schemaVersion: 'agent-event/v1';
  readonly type:
    | 'invocation.accepted'
    | 'invocation.started'
    | 'invocation.exited'
    | 'invocation.finished';
  readonly invocationId: string;
  readonly at: string;
  readonly message?: string;
}
