export interface AgentVersionProbe {
  readonly args: readonly string[];
  readonly stream: 'stdout' | 'stderr';
  readonly prefix?: string;
  readonly timeoutMs: number;
}
