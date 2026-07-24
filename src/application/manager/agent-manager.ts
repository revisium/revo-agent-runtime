import { validateManagerOptions } from '../../runtime/definition/index.js';
import type { ExecutableProbePort } from '../../runtime/probe/index.js';
import { SealedAgentRegistry } from '../../runtime/registry/index.js';
import type { AgentDescriptor, AgentRef } from '../../runtime/spec/index.js';

interface M1AgentDiscovery {
  listAgents(): readonly AgentDescriptor[];
  getAgent(agent: AgentRef): AgentDescriptor | undefined;
}

class InternalM1AgentDiscovery implements M1AgentDiscovery {
  private readonly registry: SealedAgentRegistry;

  constructor(registry: SealedAgentRegistry) {
    this.registry = registry;
    Object.freeze(this);
  }

  listAgents(): readonly AgentDescriptor[] {
    return this.registry.listAgents();
  }

  getAgent(agent: AgentRef): AgentDescriptor | undefined {
    return this.registry.getAgent(agent);
  }
}

export const createM1AgentDiscovery = (
  options: unknown,
  _probePort: ExecutableProbePort,
): M1AgentDiscovery => {
  const validated = validateManagerOptions(options);
  const registry = SealedAgentRegistry.create(validated.definitions);

  return new InternalM1AgentDiscovery(registry);
};
