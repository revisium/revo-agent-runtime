export interface AgentUsage {
  readonly inputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly outputTokens?: number;
  readonly reasoningOutputTokens?: number;
  readonly reportedCost?: number;
  readonly reportedCurrency?: string;
}
