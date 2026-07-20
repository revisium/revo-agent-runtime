import type { JsonObject } from '../json/index.js';
import type { AgentDefinitionContract } from './agent-definition-contract.js';

export interface AgentRef extends JsonObject {
  readonly id: string;
  readonly version: string;
}

export interface AgentDescriptor {
  readonly agent: AgentRef;
  readonly definitionDigest: string;
  readonly displayName: string;
  readonly description?: string;
  readonly capabilities: AgentDefinitionContract['capabilities'];
}
