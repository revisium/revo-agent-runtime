import type { JsonObject, JsonValue } from '../../../../contracts/agent-definition.js';
import {
  canonicalizeCopiedJsonBytes,
  inspectAndCopyPlainJson,
  isJsonObject,
} from '../../../../definition/canonical-json.js';

export interface SessionJsonLimits {
  readonly maxBytes: number;
  readonly maxDepth: number;
  readonly maxNodes: number;
}

export class SessionJsonError extends TypeError {
  constructor() {
    super('Invalid session JSON value.');
    this.name = 'SessionJsonError';
  }
}

const invalidJson = (): never => {
  throw new SessionJsonError();
};

const isJsonArray = (value: JsonValue): value is readonly JsonValue[] => Array.isArray(value);

const freezeGraph = (root: JsonValue): JsonValue => {
  const pending: JsonValue[] = [root];
  for (let value = pending.pop(); value !== undefined; value = pending.pop()) {
    if (typeof value !== 'object' || value === null) continue;
    if (isJsonArray(value)) {
      for (const child of value) pending.push(child);
    } else {
      for (const child of Object.values(value)) pending.push(child);
    }
    const toJson = Reflect.getOwnPropertyDescriptor(value, 'toJSON');
    if (toJson?.enumerable === false && toJson.value === undefined)
      Reflect.deleteProperty(value, 'toJSON');
    Object.freeze(value);
  }
  return root;
};

const validLimits = ({ maxBytes, maxDepth, maxNodes }: SessionJsonLimits): boolean =>
  Number.isSafeInteger(maxBytes) &&
  maxBytes >= 1 &&
  Number.isSafeInteger(maxDepth) &&
  maxDepth >= 1 &&
  Number.isSafeInteger(maxNodes) &&
  maxNodes >= 1;

export const decodeImmutableJson = (value: unknown, limits: SessionJsonLimits): JsonValue => {
  if (!validLimits(limits)) return invalidJson();
  try {
    const inspection = inspectAndCopyPlainJson(value);
    if (inspection.depth > limits.maxDepth || inspection.nodes > limits.maxNodes)
      return invalidJson();
    if (canonicalizeCopiedJsonBytes(inspection.copy).byteLength > limits.maxBytes)
      return invalidJson();
    return freezeGraph(inspection.copy);
  } catch {
    return invalidJson();
  }
};

export const decodeImmutableJsonObject = (
  value: unknown,
  limits: SessionJsonLimits,
): Readonly<JsonObject> => {
  const decoded = decodeImmutableJson(value, limits);
  if (!isJsonObject(decoded)) return invalidJson();
  return decoded;
};

export const immutableJsonByteLength = (value: JsonValue): number =>
  canonicalizeCopiedJsonBytes(value).byteLength;

export const hasExactJsonKeys = (
  value: Readonly<JsonObject>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean => {
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  return (
    required.every((key) => Object.hasOwn(value, key)) && keys.every((key) => allowed.has(key))
  );
};
