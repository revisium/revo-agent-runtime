import { Ajv2020 } from 'ajv/dist/2020.js';

import type { JsonObject, JsonValue } from '../contracts/agent-definition.js';
import {
  canonicalizeCopiedJsonBytes,
  inspectAndCopyPlainJson,
  isJsonObject,
} from './canonical-json.js';

const dialect = 'https://json-schema.org/draft/2020-12/schema';
const schemaByteLimit = 1_048_576;
const schemaDepthLimit = 64;
const schemaNodeLimit = 8_192;
const allowedKeywords = new Set([
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

interface Reference {
  readonly source: string;
  readonly target: string;
}

const isSchemaLocation = (value: JsonValue | undefined): value is boolean | JsonObject =>
  typeof value === 'boolean' || isJsonObject(value);

const pointerToken = (value: string): string => value.replaceAll('~', '~0').replaceAll('/', '~1');

const pointerFromReference = (reference: string): string | undefined => {
  if (reference === '#') return '';
  if (!reference.startsWith('#/') || reference.includes('%')) return undefined;
  const source = reference.slice(2);
  if (/(?:^|[^~])~(?:[^01]|$)/.test(source)) return undefined;
  return source
    .split('/')
    .map((token) => token.replaceAll('~1', '/').replaceAll('~0', '~'))
    .map(pointerToken)
    .reduce((pointer, token) => `${pointer}/${token}`, '');
};

const hasAcyclicReferences = (references: readonly Reference[]): boolean => {
  const edges = new Map(references.map(({ source, target }) => [source, target]));
  const colors = new Map<string, 'black' | 'gray'>();
  const visit = (pointer: string): boolean => {
    colors.set(pointer, 'gray');
    const target = edges.get(pointer);
    if (target !== undefined) {
      if (colors.get(target) === 'gray') return false;
      if (colors.get(target) === undefined && !visit(target)) return false;
    }
    colors.set(pointer, 'black');
    return true;
  };

  return [...edges.keys()].every((pointer) => colors.get(pointer) !== undefined || visit(pointer));
};

type SchemaLocationVisitor = (
  value: JsonValue | undefined,
  pointer: string,
  root: boolean,
) => boolean;

const validSchemaObject = (value: JsonObject, root: boolean): boolean => {
  if ((root && value.$schema !== dialect) || (!root && value.$schema !== undefined)) return false;
  return !Object.keys(value).some((key) => !allowedKeywords.has(key));
};

const validSchemaReference = (
  value: JsonObject,
  pointer: string,
  root: boolean,
  references: Reference[],
): boolean => {
  const reference = value.$ref;
  if (reference === undefined) return true;
  if (typeof reference !== 'string') return false;
  const permittedSiblings = root ? new Set(['$schema', '$ref', '$defs']) : new Set(['$ref']);
  if (Object.keys(value).some((key) => !permittedSiblings.has(key))) return false;
  const target = pointerFromReference(reference);
  if (target === undefined) return false;
  references.push({ source: pointer, target });
  return true;
};

const visitSchemaChildren = (
  value: JsonObject,
  pointer: string,
  visit: SchemaLocationVisitor,
): boolean => {
  for (const key of ['$defs', 'properties']) {
    const members = value[key];
    if (members === undefined) continue;
    if (!isJsonObject(members)) return false;
    for (const [name, member] of Object.entries(members)) {
      if (!visit(member, `${pointer}/${pointerToken(key)}/${pointerToken(name)}`, false))
        return false;
    }
  }
  for (const key of ['additionalProperties', 'items']) {
    const member = value[key];
    if (member !== undefined && !visit(member, `${pointer}/${pointerToken(key)}`, false))
      return false;
  }
  return true;
};

const validateSchemaLocations = (schema: JsonObject): boolean => {
  const locations = new Set<string>();
  const references: Reference[] = [];
  const visit: SchemaLocationVisitor = (value, pointer, root): boolean => {
    if (!isSchemaLocation(value)) return false;
    locations.add(pointer);
    if (typeof value === 'boolean') return true;
    return (
      validSchemaObject(value, root) &&
      validSchemaReference(value, pointer, root, references) &&
      visitSchemaChildren(value, pointer, visit)
    );
  };

  if (!visit(schema, '', true)) return false;
  if (references.some(({ target }) => !locations.has(target))) return false;
  return hasAcyclicReferences(references);
};

const hasConsumerSchemaProfile = (schema: JsonObject): boolean => {
  const inspection = inspectAndCopyPlainJson(schema);
  if (inspection.depth > schemaDepthLimit || inspection.nodes > schemaNodeLimit) return false;
  if (canonicalizeCopiedJsonBytes(inspection.copy).byteLength > schemaByteLimit) return false;
  return isJsonObject(inspection.copy) && validateSchemaLocations(inspection.copy);
};

export const validatesDefaults = (
  schema: JsonObject,
  defaults: JsonObject | undefined,
): boolean => {
  if (!hasConsumerSchemaProfile(schema)) return false;
  if (defaults === undefined) return true;
  try {
    const schemaCopy = inspectAndCopyPlainJson(schema).copy;
    const defaultsCopy = inspectAndCopyPlainJson(defaults).copy;
    return new Ajv2020({
      allErrors: true,
      allowUnionTypes: true,
      coerceTypes: false,
      messages: true,
      ownProperties: true,
      removeAdditional: false,
      strict: true,
      useDefaults: false,
      validateFormats: false,
    }).compile(schemaCopy)(defaultsCopy);
  } catch {
    return false;
  }
};
