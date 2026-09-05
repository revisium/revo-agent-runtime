import type { AgentDefinitionInput } from '../agent-definition.js';
import type { AgentSessionManagerOptions } from '../session/api/manager.js';
import type { ActiveInvocationStateSink, AgentManagerLimits } from './core.js';

export interface AgentManagerOptions {
  readonly definitions: readonly AgentDefinitionInput[];
  readonly activeStateSink: ActiveInvocationStateSink;
  readonly limits?: AgentManagerLimits;
  readonly redaction?: { readonly secrets: readonly string[] };
  readonly sessions?: AgentSessionManagerOptions;
}
