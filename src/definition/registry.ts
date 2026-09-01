import type { AgentRef } from '../contracts/agent-definition.js';
import { DuplicateAgentDefinitionError, type ValidatedAgentDefinition } from './errors.js';
import { compareUtf8 } from './utf8-order.js';

const readExactRef = (value: unknown): AgentRef | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 2 || !keys.includes('id') || !keys.includes('version')) return undefined;
  const id = Object.getOwnPropertyDescriptor(value, 'id');
  const version = Object.getOwnPropertyDescriptor(value, 'version');
  if (
    id === undefined ||
    version === undefined ||
    !Object.hasOwn(id, 'value') ||
    !Object.hasOwn(version, 'value') ||
    typeof id.value !== 'string' ||
    typeof version.value !== 'string'
  )
    return undefined;
  return { id: id.value, version: version.value };
};

export interface SealedAgentRegistry {
  list(): readonly ValidatedAgentDefinition[];
  get(ref: unknown): ValidatedAgentDefinition | undefined;
}

export const sealAgentRegistry = (
  inputs: readonly unknown[],
  validate: (input: unknown) => ValidatedAgentDefinition,
): SealedAgentRegistry => {
  const entries = inputs.map(validate);
  const byIdentity = new Map<string, Map<string, ValidatedAgentDefinition>>();
  for (const [index, entry] of entries.entries()) {
    const { id, version } = entry.definition;
    const versions = byIdentity.get(id);
    const existing = versions?.get(version);
    if (existing !== undefined)
      throw new DuplicateAgentDefinitionError({ id, version }, entries.indexOf(existing), index);
    if (versions === undefined) byIdentity.set(id, new Map([[version, entry]]));
    else versions.set(version, entry);
  }
  const ordered = Object.freeze(
    [...entries].sort((left, right) => {
      const idDifference = compareUtf8(left.definition.id, right.definition.id);
      return idDifference === 0
        ? compareUtf8(left.definition.version, right.definition.version)
        : idDifference;
    }),
  );
  return Object.freeze({
    list: (): readonly ValidatedAgentDefinition[] => ordered,
    get: (ref: unknown): ValidatedAgentDefinition | undefined => {
      const exactRef = readExactRef(ref);
      return exactRef === undefined
        ? undefined
        : byIdentity.get(exactRef.id)?.get(exactRef.version);
    },
  });
};
