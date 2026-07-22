import { createHash } from 'node:crypto';

import { AgentManagerError } from '../../errors/index.js';
import { AGENT_FAULT_MESSAGES } from '../../policy/index.js';
import type { AgentFault, JsonObject, JsonValue } from '../../spec/index.js';
import { inspectPlainJson } from '../plain-json/index.js';
import { canonicalizeJsonBytes } from '../rfc8785/index.js';
import type { DefinitionIdentity } from './definition-identity.js';

const createInternalConstructionFault = (): AgentFault => ({
  code: 'revo.agent.internal',
  message: AGENT_FAULT_MESSAGES.internalConstruction,
  phase: 'construction',
  retryable: false,
});

const throwInternalConstructionFault = (): never => {
  throw new AgentManagerError(createInternalConstructionFault());
};

const mapInternalConstructionFailure = <Value>(operation: () => Value): Value => {
  try {
    return operation();
  } catch {
    return throwInternalConstructionFault();
  }
};

const createDigest = (canonicalBytes: Uint8Array): string =>
  createHash('sha256').update(canonicalBytes).digest('hex');

const parseCanonicalJson = (canonicalBytes: Uint8Array): unknown =>
  JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(canonicalBytes));

const isJsonObject = (value: unknown): value is JsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isJsonArray = (value: JsonValue): value is readonly JsonValue[] => Array.isArray(value);

const freezeJsonValue = (value: JsonValue): void => {
  if (value === null || typeof value !== 'object') return;

  if (isJsonArray(value)) {
    for (const item of value) freezeJsonValue(item);
  } else {
    for (const item of Object.values(value)) freezeJsonValue(item);
  }

  Object.freeze(value);
};

const createFrozenSnapshot = (value: unknown): JsonObject => {
  inspectPlainJson(value, '/definition');
  if (!isJsonObject(value)) return throwInternalConstructionFault();

  freezeJsonValue(value);
  return value;
};

export const createDefinitionIdentity = (value: JsonObject): DefinitionIdentity => {
  const canonicalBytes = mapInternalConstructionFailure(() => canonicalizeJsonBytes(value));
  const digest = mapInternalConstructionFailure(() => createDigest(canonicalBytes));
  const snapshot = mapInternalConstructionFailure(() =>
    createFrozenSnapshot(parseCanonicalJson(canonicalBytes)),
  );

  return mapInternalConstructionFailure(() => Object.freeze({ digest, snapshot }));
};
