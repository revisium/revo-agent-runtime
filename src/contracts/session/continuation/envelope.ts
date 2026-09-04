import type { JsonObject } from '../../agent-definition.js';
import type { AgentSessionUsage } from '../lifecycle/result.js';

export interface AgentSessionContinuationEnvelope {
  readonly schemaVersion: 'agent-session-continuation-envelope/v1';
  readonly provider: {
    readonly format: string;
    readonly data: Readonly<JsonObject>;
  };
  readonly usageBaseline: AgentSessionUsage;
}
