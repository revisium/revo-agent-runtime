import type { JsonObject } from '../json/index.js';
import type { AgentFaultCode } from './agent-fault-code.js';

export interface AgentFault {
  readonly code: AgentFaultCode;
  readonly message: string;
  readonly phase: 'construction' | 'probing';
  readonly retryable: boolean;
  readonly details?: JsonObject;
}
