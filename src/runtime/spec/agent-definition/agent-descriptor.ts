import type { AgentDefinitionContract } from './agent-definition-contract.js';
import type { AgentRef } from './agent-ref.js';

export interface AgentDescriptor {
  readonly agent: AgentRef;
  readonly definitionDigest: string;
  readonly displayName: string;
  readonly description?: string;
  readonly capabilities: AgentDefinitionContract['capabilities'];
}
