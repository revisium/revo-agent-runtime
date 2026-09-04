import type { AgentDefinitionSessionCapabilities } from '../../agent-definition.js';
import type { AgentDescriptor } from '../../manager/core.js';

export interface AgentSessionCapabilities {
  readonly multiTurn: true;
  readonly resume: 'none' | 'native';
  readonly interactions: {
    readonly permission: boolean;
    readonly input: boolean;
  };
  readonly updates: {
    readonly message: true;
    readonly progress: boolean;
    readonly tool: boolean;
    readonly plan: boolean;
    readonly usage: boolean;
  };
}

export interface AgentSessionAgentDescriptor extends AgentDescriptor {
  readonly capabilities: AgentDescriptor['capabilities'] & {
    readonly session: AgentDefinitionSessionCapabilities;
  };
}
