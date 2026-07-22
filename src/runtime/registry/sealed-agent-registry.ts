import { compareUtf8, type ValidatedDefinition } from '../definition/index.js';
import type { AgentDescriptor } from '../spec/index.js';

type ExactRef = readonly [id: string, version: string];

interface RegistryEntry {
  readonly definition: ValidatedDefinition;
  readonly descriptor: AgentDescriptor;
}

const createDescriptor = ({ definition, definitionDigest }: ValidatedDefinition): AgentDescriptor =>
  Object.freeze({
    agent: Object.freeze({ id: definition.id, version: definition.version }),
    definitionDigest,
    displayName: definition.displayName,
    ...(definition.description === undefined ? {} : { description: definition.description }),
    capabilities: Object.freeze({ ...definition.capabilities }),
  });

const compareDescriptors = (left: AgentDescriptor, right: AgentDescriptor): number => {
  const idDifference = compareUtf8(left.agent.id, right.agent.id);
  if (idDifference !== 0) return idDifference;
  return compareUtf8(left.agent.version, right.agent.version);
};

const readExactRef = (value: unknown): ExactRef | undefined => {
  if (value === null || typeof value !== 'object') return undefined;

  const keys = Reflect.ownKeys(value);
  if (keys.length !== 2 || !keys.includes('id') || !keys.includes('version')) return undefined;

  const id = Object.getOwnPropertyDescriptor(value, 'id');
  const version = Object.getOwnPropertyDescriptor(value, 'version');
  if (
    id === undefined ||
    version === undefined ||
    !('value' in id) ||
    !('value' in version) ||
    typeof id.value !== 'string' ||
    typeof version.value !== 'string'
  )
    return undefined;

  return [id.value, version.value];
};

export class SealedAgentRegistry {
  readonly #byId: ReadonlyMap<string, ReadonlyMap<string, RegistryEntry>>;
  readonly #descriptors: readonly AgentDescriptor[];

  private constructor(
    byId: ReadonlyMap<string, ReadonlyMap<string, RegistryEntry>>,
    descriptors: readonly AgentDescriptor[],
  ) {
    this.#byId = byId;
    this.#descriptors = descriptors;
    Object.freeze(this);
  }

  static create(definitions: readonly ValidatedDefinition[]): SealedAgentRegistry {
    const byId = new Map<string, Map<string, RegistryEntry>>();
    const descriptors: AgentDescriptor[] = [];

    for (const definition of definitions) {
      const entry = Object.freeze({ definition, descriptor: createDescriptor(definition) });
      const versions = byId.get(definition.definition.id);
      if (versions === undefined)
        byId.set(definition.definition.id, new Map([[definition.definition.version, entry]]));
      else versions.set(definition.definition.version, entry);
      descriptors.push(entry.descriptor);
    }

    descriptors.sort(compareDescriptors);
    return new SealedAgentRegistry(byId, Object.freeze(descriptors));
  }

  listAgents(): readonly AgentDescriptor[] {
    return this.#descriptors;
  }

  getAgent(ref: unknown): AgentDescriptor | undefined {
    return this.#getEntry(ref)?.descriptor;
  }

  getDefinition(ref: unknown): ValidatedDefinition | undefined {
    return this.#getEntry(ref)?.definition;
  }

  #getEntry(ref: unknown): RegistryEntry | undefined {
    const exactRef = readExactRef(ref);
    if (exactRef === undefined) return undefined;

    return this.#byId.get(exactRef[0])?.get(exactRef[1]);
  }
}
