import type { AgentExecutionPin } from '../../manager.js';
import type { AgentSessionEventCursor } from '../events/event.js';

interface AgentSessionContinuationBase {
  readonly sessionId: string;
  readonly pin: AgentExecutionPin;
  readonly cursor: AgentSessionEventCursor;
  readonly payload: string;
  readonly sha256: string;
}

export interface AgentSessionCheckpoint extends AgentSessionContinuationBase {
  readonly schemaVersion: 'agent-session-checkpoint/v1';
  readonly checkpointId: string;
  readonly eligibility: 'observation_only';
}

export interface AgentSessionResumeToken extends AgentSessionContinuationBase {
  readonly schemaVersion: 'agent-session-resume-token/v1';
  readonly resumeTokenId: string;
  readonly eligibility: 'hibernated';
}

export type AgentSessionHibernateResult =
  | { readonly state: 'hibernated'; readonly resumeToken: AgentSessionResumeToken }
  | { readonly state: 'already_hibernated'; readonly resumeToken: AgentSessionResumeToken };
