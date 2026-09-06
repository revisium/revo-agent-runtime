import type { CancelAgentSessionTurnResult, AgentSessionTurnResult } from '../lifecycle/result.js';

export interface AgentSessionTurn {
  readonly sessionId: string;
  readonly turnId: string;
  result(): Promise<AgentSessionTurnResult>;
  cancel(reason?: string): Promise<CancelAgentSessionTurnResult>;
}

export type AgentSessionTurnSnapshot = {
  readonly sessionId: string;
  readonly turnId: string;
} & (
  | { readonly state: 'running' }
  | { readonly state: 'completed'; readonly result: AgentSessionTurnResult }
);
