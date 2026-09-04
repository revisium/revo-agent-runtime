import type { AgentExecutionPin } from '../../manager.js';
import type { AgentSessionCapabilities } from '../capabilities/negotiated.js';
import type {
  RespondAgentSessionRequest,
  RespondAgentSessionResult,
} from '../interaction/response.js';
import type {
  AgentSessionCheckpoint,
  AgentSessionHibernateResult,
} from '../lifecycle/checkpoint.js';
import type { CancelAgentSessionResult, CloseAgentSessionResult } from '../lifecycle/result.js';
import type { AgentSessionCommandContext, SendAgentSessionInput } from '../requests/send.js';
import type { AgentSessionTurn } from './turn.js';

export interface AgentSession {
  readonly sessionId: string;
  readonly pin: AgentExecutionPin;
  readonly capabilities: AgentSessionCapabilities;

  send(
    input: SendAgentSessionInput,
    context?: AgentSessionCommandContext,
  ): Promise<AgentSessionTurn>;

  respond(input: RespondAgentSessionRequest): Promise<RespondAgentSessionResult>;
  checkpoint(): Promise<AgentSessionCheckpoint>;
  hibernate(reason?: string): Promise<AgentSessionHibernateResult>;
  close(reason?: string): Promise<CloseAgentSessionResult>;
  cancel(reason?: string): Promise<CancelAgentSessionResult>;
}
