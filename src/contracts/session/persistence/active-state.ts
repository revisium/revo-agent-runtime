import type { ActiveProcessIdentity, AgentExecutionPin } from '../../manager.js';

export interface ActiveAgentSessionSnapshot {
  readonly sessionId: string;
  readonly incarnationId: string;
  readonly pin: AgentExecutionPin;
  readonly state: 'opening' | 'idle' | 'running' | 'cancelling' | 'hibernating' | 'closing';
  readonly process: ActiveProcessIdentity;
  readonly acceptedAt: string;
}

export type ActiveAgentSessionStateMutationResult =
  | { readonly state: 'applied' }
  | { readonly state: 'not_owner' };

export interface ActiveAgentSessionStateSink {
  save(
    snapshot: ActiveAgentSessionSnapshot,
    context: { readonly signal: AbortSignal },
  ): Promise<ActiveAgentSessionStateMutationResult>;

  remove(
    identity: { readonly sessionId: string; readonly incarnationId: string },
    context: { readonly signal: AbortSignal },
  ): Promise<ActiveAgentSessionStateMutationResult>;
}
