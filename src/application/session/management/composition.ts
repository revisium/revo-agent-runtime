import type { AgentDescriptor } from '../../../contracts/manager/core.js';
import type { AgentSessionManagerOptions } from '../../../contracts/session/api/manager.js';
import type { SealedAgentRegistry } from '../../../definition/index.js';
import type { ManagedAgentSessionController } from './managed-sessions.js';

interface AgentSessionCompositionInput {
  readonly agents: readonly AgentDescriptor[];
  readonly definitions: SealedAgentRegistry;
  readonly options: AgentSessionManagerOptions;
}

export interface AgentSessionComposer {
  create(input: AgentSessionCompositionInput): ManagedAgentSessionController;
}
