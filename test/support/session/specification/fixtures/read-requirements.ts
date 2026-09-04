import { readArtifactJson } from './read.js';

interface SessionRequirementManifest {
  readonly schemaVersion: 'agent-session-requirements/v1';
  readonly sourcePin: string;
  readonly requirementIds: readonly string[];
}

const sourcePin = '2fb61d1426809e8698e897adcfbd0d0050f58c2a';
const groupCounts = {
  API: 16,
  DUR: 9,
  LIFE: 23,
  PROV: 7,
  ARCH: 9,
  VER: 8,
} as const;
const expectedIds = Object.entries(groupCounts).flatMap(([prefix, count]) =>
  Array.from({ length: count }, (_, index) => `${prefix}-${String(index + 1).padStart(3, '0')}`),
);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const hasExactKeys = (value: Record<string, unknown>): boolean =>
  Object.keys(value).length === 3 &&
  ['schemaVersion', 'sourcePin', 'requirementIds'].every((key) => Object.hasOwn(value, key));

export const validateSessionRequirementManifest = (value: unknown): SessionRequirementManifest => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value) ||
    value.schemaVersion !== 'agent-session-requirements/v1' ||
    value.sourcePin !== sourcePin ||
    !Array.isArray(value.requirementIds) ||
    !value.requirementIds.every(
      (id) => typeof id === 'string' && /^(?:API|DUR|LIFE|PROV|ARCH|VER)-\d{3}$/.test(id),
    ) ||
    value.requirementIds.length !== expectedIds.length ||
    new Set(value.requirementIds).size !== expectedIds.length ||
    value.requirementIds.some((id, index) => id !== expectedIds[index])
  )
    throw new TypeError('Invalid session requirement manifest.');
  return {
    schemaVersion: 'agent-session-requirements/v1',
    sourcePin,
    requirementIds: value.requirementIds,
  };
};

export const readSessionRequirementManifest = async (): Promise<SessionRequirementManifest> =>
  validateSessionRequirementManifest(
    await readArtifactJson('requirements/source-requirements-v1.json'),
  );
