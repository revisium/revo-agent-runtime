import { canonicalizeJsonBytes, inspectAndCopyPlainJson } from './canonical-json.js';
import { DefinitionValidationError, type ValidatedAgentDefinition } from './errors.js';
import { identifyAgentDefinition } from './identity.js';
import { definitionByteLimit, parseAgentDefinitionShape } from './schema.js';
import { invalidDefinition, validateDefinitionSemantics } from './validation.js';

const textDecoder = new TextDecoder('utf-8', { fatal: true });

const parseCanonicalDefinition = (canonicalBytes: Uint8Array): unknown =>
  JSON.parse(textDecoder.decode(canonicalBytes));

const readDefinition = (value: unknown) => {
  const input = parseAgentDefinitionShape(value);
  return input === undefined ? invalidDefinition() : validateDefinitionSemantics(input);
};

export const validateAgentDefinition = (input: unknown): ValidatedAgentDefinition => {
  try {
    inspectAndCopyPlainJson(input);
    const parsedDefinition = readDefinition(input);
    const canonicalBytes = canonicalizeJsonBytes(parsedDefinition);
    if (canonicalBytes.byteLength > definitionByteLimit) return invalidDefinition();
    const snapshot = parseCanonicalDefinition(canonicalBytes);
    return identifyAgentDefinition(readDefinition(snapshot), canonicalBytes);
  } catch (error: unknown) {
    if (error instanceof DefinitionValidationError) throw error;
    return invalidDefinition();
  }
};
