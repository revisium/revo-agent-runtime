import type { CancelAgentSessionTurnResult, AgentSessionTurnResult } from '../lifecycle/result.js';

export interface AgentSessionTurn {
  readonly sessionId: string;
  readonly turnId: string;
  result(): Promise<AgentSessionTurnResult>;
  cancel(reason?: string): Promise<CancelAgentSessionTurnResult>;
}
