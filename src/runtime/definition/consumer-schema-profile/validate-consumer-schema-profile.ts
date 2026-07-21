import { AGENT_RUNTIME_LIMITS } from '../../policy/index.js';
import type { JsonObject, JsonSchema202012 } from '../../spec/index.js';
import { inspectPlainJson } from '../plain-json/index.js';
import { canonicalizeJsonBytes } from '../rfc8785/index.js';
import {
  normalizeValidationDiagnostics,
  type ValidationDiagnosticInput,
} from '../validation-diagnostics/index.js';
import type { ConsumerSchemaProfileValidation } from './consumer-schema-profile-validation.js';

const CONSUMER_SCHEMA_PROFILE_KEYWORDS = new Set([
  '$schema',
  '$ref',
  '$defs',
  'type',
  'enum',
  'const',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'uniqueItems',
]);

const ROOT_DIALECT = 'https://json-schema.org/draft/2020-12/schema';
const ROOT_REF_SIBLINGS = new Set(['$schema', '$ref', '$defs']);
const NESTED_REF_SIBLINGS = new Set(['$ref']);

const diagnosticMessages = {
  keyword_allowlist: 'Keyword is not allowed by the consumer-schema profile.',
  ref_acyclic: 'Local reference graph must be acyclic.',
  ref_local: 'Reference must be local to the root schema.',
  ref_pointer: 'Reference must use an unencoded valid JSON Pointer fragment.',
  ref_resolved: 'Reference must resolve to a schema location.',
  ref_siblings: 'Reference schema contains forbidden sibling keywords.',
  root_dialect: 'Schema dialect must be declared exactly at the root.',
  schema_bytes: 'Schema canonical UTF-8 representation exceeds 1 MiB.',
  schema_depth: 'Schema JSON depth exceeds 64.',
  schema_location: 'Value must be a boolean or object consumer schema.',
  schema_nodes: 'Schema JSON node count exceeds 8,192.',
} as const;

type DiagnosticKeyword = keyof typeof diagnosticMessages;
type SchemaLocationValue = boolean | JsonObject;

interface SchemaLocation {
  readonly instancePath: string;
  readonly pointer: string;
  readonly value: SchemaLocationValue;
}

interface ReferenceEdge {
  readonly destination: string;
  readonly instancePath: string;
}

interface ProfileCollection {
  readonly diagnostics: readonly ValidationDiagnosticInput[];
  readonly locations: ReadonlyMap<string, SchemaLocation>;
}

const encoder = new TextEncoder();

const escapePointerToken = (token: string): string =>
  token.replaceAll('~', '~0').replaceAll('/', '~1');

const appendPointerToken = (path: string, token: string): string =>
  `${path}/${escapePointerToken(token)}`;

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isJsonSchema = (value: unknown): value is JsonSchema202012 => isJsonObject(value);

const isSchemaLocation = (value: unknown): value is SchemaLocationValue =>
  typeof value === 'boolean' || isJsonObject(value);

const readOwnDataValue = (container: JsonObject, key: string): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(container, key);
  return descriptor !== undefined && Object.hasOwn(descriptor, 'value')
    ? descriptor.value
    : undefined;
};

const hasOwnDataValue = (container: JsonObject, key: string): boolean =>
  Object.hasOwn(container, key);

const diagnostic = (
  instancePath: string,
  keyword: DiagnosticKeyword,
): ValidationDiagnosticInput => ({
  instancePath,
  schemaPath: `/${keyword}`,
  keyword,
  message: diagnosticMessages[keyword],
});

const invalid = (inputs: readonly ValidationDiagnosticInput[]): ConsumerSchemaProfileValidation =>
  Object.freeze({ valid: false, diagnostics: normalizeValidationDiagnostics(inputs) });

const collectNameMapLocations = (
  parent: SchemaLocation,
  keyword: '$defs' | 'properties',
  value: unknown,
  frames: SchemaLocation[],
  diagnostics: ValidationDiagnosticInput[],
): void => {
  const valuePath = appendPointerToken(parent.instancePath, keyword);
  const valuePointer = appendPointerToken(parent.pointer, keyword);
  if (!isJsonObject(value)) {
    diagnostics.push(diagnostic(valuePath, 'schema_location'));
    return;
  }

  for (const name of Object.keys(value).toReversed()) {
    const member = readOwnDataValue(value, name);
    const memberPath = appendPointerToken(valuePath, name);
    if (!isSchemaLocation(member)) {
      diagnostics.push(diagnostic(memberPath, 'schema_location'));
      continue;
    }

    frames.push({
      instancePath: memberPath,
      pointer: appendPointerToken(valuePointer, name),
      value: member,
    });
  }
};

const collectDirectSchemaLocation = (
  parent: SchemaLocation,
  keyword: 'additionalProperties' | 'items',
  value: unknown,
  frames: SchemaLocation[],
  diagnostics: ValidationDiagnosticInput[],
): void => {
  const locationPath = appendPointerToken(parent.instancePath, keyword);
  if (!isSchemaLocation(value)) {
    diagnostics.push(diagnostic(locationPath, 'schema_location'));
    return;
  }

  frames.push({
    instancePath: locationPath,
    pointer: appendPointerToken(parent.pointer, keyword),
    value,
  });
};

const collectSchemaLocationDiagnostics = (
  location: SchemaLocation,
  value: JsonObject,
  rootInstancePath: string,
  diagnostics: ValidationDiagnosticInput[],
): void => {
  if (location.pointer === '' && readOwnDataValue(value, '$schema') !== ROOT_DIALECT) {
    diagnostics.push(diagnostic(rootInstancePath, 'root_dialect'));
  }

  for (const key of Object.keys(value)) {
    const keyPath = appendPointerToken(location.instancePath, key);
    if (!CONSUMER_SCHEMA_PROFILE_KEYWORDS.has(key))
      diagnostics.push(diagnostic(keyPath, 'keyword_allowlist'));
    if (location.pointer !== '' && key === '$schema') {
      diagnostics.push(diagnostic(keyPath, 'root_dialect'));
    }
  }
};

const collectNestedSchemaLocations = (
  location: SchemaLocation,
  value: JsonObject,
  frames: SchemaLocation[],
  diagnostics: ValidationDiagnosticInput[],
): void => {
  for (const key of Object.keys(value).toReversed()) {
    const nestedValue = readOwnDataValue(value, key);
    if (key === '$defs' || key === 'properties') {
      collectNameMapLocations(location, key, nestedValue, frames, diagnostics);
    }
    if (key === 'additionalProperties' || key === 'items') {
      collectDirectSchemaLocation(location, key, nestedValue, frames, diagnostics);
    }
  }
};

const collectProfile = (root: JsonObject, instancePath: string): ProfileCollection => {
  const diagnostics: ValidationDiagnosticInput[] = [];
  const locations = new Map<string, SchemaLocation>();
  const frames: SchemaLocation[] = [{ instancePath, pointer: '', value: root }];

  for (let location = frames.pop(); location !== undefined; location = frames.pop()) {
    locations.set(location.pointer, location);
    if (!isJsonObject(location.value)) continue;

    collectSchemaLocationDiagnostics(location, location.value, instancePath, diagnostics);
    collectNestedSchemaLocations(location, location.value, frames, diagnostics);
  }

  return { diagnostics, locations };
};

const decodePointerTokens = (reference: string): readonly string[] | undefined => {
  if (reference.includes('%')) return undefined;
  if (reference === '#') return [];
  if (!reference.startsWith('#/')) return undefined;

  const tokens: string[] = [];
  for (const encodedToken of reference.slice(2).split('/')) {
    let token = '';
    for (let index = 0; index < encodedToken.length; index += 1) {
      const character = encodedToken[index];
      if (character !== '~') {
        token += character;
        continue;
      }

      const escape = encodedToken[index + 1];
      if (escape === '0') token += '~';
      else if (escape === '1') token += '/';
      else return undefined;
      index += 1;
    }
    tokens.push(token);
  }

  return tokens;
};

const resolveReference = (
  root: JsonObject,
  tokens: readonly string[],
  locations: ReadonlyMap<string, SchemaLocation>,
): string | undefined => {
  let value: unknown = root;
  let pointer = '';
  for (const token of tokens) {
    if (!isJsonObject(value) || !hasOwnDataValue(value, token)) return undefined;
    value = readOwnDataValue(value, token);
    pointer = appendPointerToken(pointer, token);
  }

  const location = locations.get(pointer);
  return location?.value === value ? pointer : undefined;
};

const collectReferenceSiblingDiagnostics = (
  location: SchemaLocation,
  value: JsonObject,
  diagnostics: ValidationDiagnosticInput[],
): void => {
  const permittedSiblings = location.pointer === '' ? ROOT_REF_SIBLINGS : NESTED_REF_SIBLINGS;
  for (const key of Object.keys(value)) {
    if (!permittedSiblings.has(key)) {
      diagnostics.push(diagnostic(appendPointerToken(location.instancePath, key), 'ref_siblings'));
    }
  }
};

const collectReferenceEdge = (
  root: JsonObject,
  location: SchemaLocation,
  value: JsonObject,
  locations: ReadonlyMap<string, SchemaLocation>,
  diagnostics: ValidationDiagnosticInput[],
): ReferenceEdge | undefined => {
  const referencePath = appendPointerToken(location.instancePath, '$ref');
  collectReferenceSiblingDiagnostics(location, value, diagnostics);

  const reference = readOwnDataValue(value, '$ref');
  if (typeof reference !== 'string' || (reference !== '#' && !reference.startsWith('#/'))) {
    diagnostics.push(diagnostic(referencePath, 'ref_local'));
    return undefined;
  }

  const tokens = decodePointerTokens(reference);
  if (tokens === undefined) {
    diagnostics.push(diagnostic(referencePath, 'ref_pointer'));
    return undefined;
  }

  const destination = resolveReference(root, tokens, locations);
  if (destination === undefined) {
    diagnostics.push(diagnostic(referencePath, 'ref_resolved'));
    return undefined;
  }

  return { destination, instancePath: referencePath };
};

const collectReferenceEdges = (
  root: JsonObject,
  locations: ReadonlyMap<string, SchemaLocation>,
): {
  readonly diagnostics: readonly ValidationDiagnosticInput[];
  readonly edges: ReadonlyMap<string, ReferenceEdge>;
} => {
  const diagnostics: ValidationDiagnosticInput[] = [];
  const edges = new Map<string, ReferenceEdge>();
  for (const location of locations.values()) {
    if (!isJsonObject(location.value) || !hasOwnDataValue(location.value, '$ref')) continue;

    const edge = collectReferenceEdge(root, location, location.value, locations, diagnostics);
    if (edge !== undefined) edges.set(location.pointer, edge);
  }

  return { diagnostics, edges };
};

const comparePointers = (left: string, right: string): number => {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  for (const [index, byte] of leftBytes.entries()) {
    const rightByte = rightBytes[index];
    if (rightByte === undefined) return 1;

    const difference = byte - rightByte;
    if (difference !== 0) return difference;
  }

  return leftBytes.byteLength - rightBytes.byteLength;
};

const collectCycleDiagnostics = (
  locations: ReadonlyMap<string, SchemaLocation>,
  edges: ReadonlyMap<string, ReferenceEdge>,
): readonly ValidationDiagnosticInput[] => {
  const diagnostics: ValidationDiagnosticInput[] = [];
  const colors = new Map<string, 'black' | 'gray'>();
  const visit = (pointer: string): void => {
    colors.set(pointer, 'gray');
    const edge = edges.get(pointer);
    if (edge !== undefined) {
      const destinationColor = colors.get(edge.destination);
      if (destinationColor === 'gray')
        diagnostics.push(diagnostic(edge.instancePath, 'ref_acyclic'));
      else if (destinationColor === undefined) visit(edge.destination);
    }
    colors.set(pointer, 'black');
  };

  for (const pointer of [...locations.keys()].sort(comparePointers)) {
    if (colors.get(pointer) === undefined) visit(pointer);
  }

  return diagnostics;
};

const resourceDiagnostics = (
  depth: number,
  nodes: number,
  instancePath: string,
): readonly ValidationDiagnosticInput[] => {
  const diagnostics: ValidationDiagnosticInput[] = [];
  if (depth > AGENT_RUNTIME_LIMITS.schemaDepth)
    diagnostics.push(diagnostic(instancePath, 'schema_depth'));
  if (nodes > AGENT_RUNTIME_LIMITS.schemaNodes)
    diagnostics.push(diagnostic(instancePath, 'schema_nodes'));
  return diagnostics;
};

export const validateConsumerSchemaProfile = (
  schema: unknown,
  instancePath: string,
): ConsumerSchemaProfileValidation => {
  const inspection = inspectPlainJson(schema, instancePath);
  if (!isJsonSchema(schema)) return invalid([diagnostic(instancePath, 'root_dialect')]);

  const resourceFailures = resourceDiagnostics(inspection.depth, inspection.nodes, instancePath);
  if (resourceFailures.length > 0) return invalid(resourceFailures);
  if (canonicalizeJsonBytes(schema).byteLength > AGENT_RUNTIME_LIMITS.schemaBytes) {
    return invalid([diagnostic(instancePath, 'schema_bytes')]);
  }

  const profile = collectProfile(schema, instancePath);
  if (profile.diagnostics.length > 0) return invalid(profile.diagnostics);

  const references = collectReferenceEdges(schema, profile.locations);
  if (references.diagnostics.length > 0) return invalid(references.diagnostics);

  const cycles = collectCycleDiagnostics(profile.locations, references.edges);
  if (cycles.length > 0) return invalid(cycles);

  return Object.freeze({ valid: true, schema });
};
