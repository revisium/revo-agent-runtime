export interface AgentSessionCommandContext {
  readonly signal?: AbortSignal;
}

export interface SendAgentSessionInput {
  readonly turnId: string;
  readonly prompt: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}
