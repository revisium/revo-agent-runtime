import type { AgentSessionResumeToken } from '../lifecycle/checkpoint.js';
import type { AgentSessionLaunchInput } from './open.js';

export interface ResumeAgentSession extends AgentSessionLaunchInput {
  readonly token: AgentSessionResumeToken;
}
