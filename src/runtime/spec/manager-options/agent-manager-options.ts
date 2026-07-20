import type { AgentDefinitionInput } from '../agent-definition/index.js';
import type { AgentManagerLimits } from './agent-manager-limits.js';

export interface AgentManagerOptions {
  readonly definitions: readonly AgentDefinitionInput[];
  readonly limits?: AgentManagerLimits;
  readonly redaction?: { readonly secrets: readonly string[] };
}
