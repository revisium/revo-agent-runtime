import type { AgentRef } from '../../contracts/agent-definition.js';
import type { AgentDescriptor } from '../../contracts/manager.js';
import type { SealedAgentRegistry, ValidatedAgentDefinition } from '../../definition/index.js';

const descriptorFrom = ({ definition, digest }: ValidatedAgentDefinition): AgentDescriptor =>
  Object.freeze({
    agent: Object.freeze({ id: definition.id, version: definition.version }),
    capabilities: definition.capabilities,
    definitionDigest: digest,
    displayName: definition.displayName,
    ...(definition.description === undefined ? {} : { description: definition.description }),
  });

export class AgentCatalog {
  private readonly descriptors: readonly AgentDescriptor[];

  constructor(private readonly definitions: SealedAgentRegistry) {
    this.descriptors = Object.freeze(definitions.list().map(descriptorFrom));
  }

  list(): readonly AgentDescriptor[] {
    return this.descriptors;
  }

  get(agent: AgentRef): AgentDescriptor | undefined {
    return this.resolve(agent)?.descriptor;
  }

  resolve(agent: AgentRef):
    | Readonly<{
        readonly definition: ValidatedAgentDefinition;
        readonly descriptor: AgentDescriptor;
      }>
    | undefined {
    let definition: ValidatedAgentDefinition | undefined;
    try {
      definition = this.definitions.get(agent);
    } catch {
      return undefined;
    }
    if (definition === undefined) return undefined;
    return Object.freeze({ definition, descriptor: descriptorFrom(definition) });
  }
}
