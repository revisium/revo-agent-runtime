import type { AgentRef } from '../contracts/agent-definition.js';
import { DuplicateAgentDefinitionError, type ValidatedAgentDefinition } from './errors.js';
import { compareUtf8 } from './utf8-order.js';

const readExactRef = (value: unknown): AgentRef | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== 3 ||
    !keys.includes('id') ||
    !keys.includes('version') ||
    !keys.includes('installationId')
  )
    return undefined;
  const id = Object.getOwnPropertyDescriptor(value, 'id');
  const version = Object.getOwnPropertyDescriptor(value, 'version');
  const installationId = Object.getOwnPropertyDescriptor(value, 'installationId');
  if (
    id === undefined ||
    version === undefined ||
    installationId === undefined ||
    !Object.hasOwn(id, 'value') ||
    !Object.hasOwn(version, 'value') ||
    !Object.hasOwn(installationId, 'value') ||
    typeof id.value !== 'string' ||
    typeof version.value !== 'string' ||
    typeof installationId.value !== 'string'
  )
    return undefined;
  return { id: id.value, version: version.value, installationId: installationId.value };
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
  const byIdentity = new Map<string, Map<string, Map<string, ValidatedAgentDefinition>>>();
  for (const [index, entry] of entries.entries()) {
    const { id, version, installationId } = entry.definition;
    const versions = byIdentity.get(id);
    const installations = versions?.get(version);
    const existing = installations?.get(installationId);
    if (existing !== undefined)
      throw new DuplicateAgentDefinitionError(
        { id, version, installationId },
        entries.indexOf(existing),
        index,
      );
    if (versions === undefined)
      byIdentity.set(id, new Map([[version, new Map([[installationId, entry]])]]));
    else if (installations === undefined) versions.set(version, new Map([[installationId, entry]]));
    else installations.set(installationId, entry);
  }
  const ordered = Object.freeze(
    [...entries].sort((left, right) => {
      const idDifference = compareUtf8(left.definition.id, right.definition.id);
      if (idDifference !== 0) return idDifference;
      const versionDifference = compareUtf8(left.definition.version, right.definition.version);
      return versionDifference === 0
        ? compareUtf8(left.definition.installationId, right.definition.installationId)
        : versionDifference;
    }),
  );
  return Object.freeze({
    list: (): readonly ValidatedAgentDefinition[] => ordered,
    get: (ref: unknown): ValidatedAgentDefinition | undefined => {
      const exactRef = readExactRef(ref);
      return exactRef === undefined
        ? undefined
        : byIdentity.get(exactRef.id)?.get(exactRef.version)?.get(exactRef.installationId);
    },
  });
};
