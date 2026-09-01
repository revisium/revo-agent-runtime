import { createHash } from 'node:crypto';

import type { AgentDefinition } from '../contracts/agent-definition.js';
import type { ValidatedAgentDefinition } from './errors.js';

const deepFreeze = (value: unknown): void => {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
  } else {
    for (const item of Object.values(value)) deepFreeze(item);
  }
  Object.freeze(value);
};

export const identifyAgentDefinition = (
  definition: AgentDefinition,
  canonicalBytes: Uint8Array,
): ValidatedAgentDefinition => {
  deepFreeze(definition);
  const digest = createHash('sha256').update(canonicalBytes).digest('hex');
  const bytes = new Uint8Array(canonicalBytes);

  return Object.freeze({
    definition,
    digest,
    canonicalBytes: (): Uint8Array => new Uint8Array(bytes),
  });
};
