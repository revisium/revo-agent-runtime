import { validateAgentDefinition } from './composition.js';
import { sealAgentRegistry } from './registry.js';
import type { SealedAgentRegistry } from './registry.js';

export { DefinitionValidationError, DuplicateAgentDefinitionError } from './errors.js';
export { validateAgentDefinition } from './composition.js';
export type { ValidatedAgentDefinition } from './errors.js';
export type { SealedAgentRegistry } from './registry.js';

export const createSealedAgentRegistry = (inputs: readonly unknown[]): SealedAgentRegistry =>
  sealAgentRegistry(inputs, validateAgentDefinition);
