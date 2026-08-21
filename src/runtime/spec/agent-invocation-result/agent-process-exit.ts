export interface AgentProcessExit {
  readonly code: number | null;
  readonly signal: string | null;
}
