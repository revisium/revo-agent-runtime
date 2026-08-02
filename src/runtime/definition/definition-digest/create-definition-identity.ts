import { createHash } from 'node:crypto';

import { AgentManagerError } from '../../errors/index.js';
import { AGENT_FAULT_MESSAGES } from '../../policy/index.js';
import type { AgentFault, JsonObject } from '../../spec/index.js';
import {
  freezeJsonValue,
  inspectPlainJson,
  isJsonObject,
  parseCanonicalJson,
} from '../plain-json/index.js';
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
