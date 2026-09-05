import type { AgentDescriptor } from '../../../contracts/manager/core.js';
import type {
  AgentSessionManagerLimits,
  AgentSessionManagerOptions,
} from '../../../contracts/session/api/manager.js';
import type { SealedAgentRegistry } from '../../../definition/index.js';
import type { ManagedAgentSessionController } from './managed-sessions.js';

export type NormalizedAgentSessionManagerOptions = Omit<AgentSessionManagerOptions, 'limits'> & {
  readonly limits: Required<AgentSessionManagerLimits>;
};

interface AgentSessionCompositionInput {
  readonly redactionSecrets: readonly string[];
  readonly agents: readonly AgentDescriptor[];
  readonly definitions: SealedAgentRegistry;
  readonly options: NormalizedAgentSessionManagerOptions;
}

export interface AgentSessionComposer {
  create(input: AgentSessionCompositionInput): ManagedAgentSessionController;
}
