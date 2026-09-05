import canonicalize from 'canonicalize';

import type { JsonObject } from '../../../../contracts/agent-definition.js';
import type { AgentSessionContinuationEnvelope } from '../../../../contracts/session/continuation/envelope.js';
import type { AgentSessionUsage } from '../../../../contracts/session/lifecycle/result.js';
import type { SessionProtocolContinuation } from '../../../../protocol/session/model/request.js';
import type { Sha256Digest } from '../../../security/digest/port.js';

const encoder = new TextEncoder();
const forbiddenKeys = new Set([
  'authorization',
  'apikey',
  'api_key',
  'credential',
  'credentials',
  'dialogue',
  'env',
  'environment',
  'frames',
  'messages',
  'password',
  'pid',
  'process',
  'secret',
  'secrets',
  'token',
  'transcript',
]);

class SessionCheckpointEncodingError extends TypeError {
  constructor() {
    super('Provider continuation cannot cross the checkpoint boundary.');
    this.name = 'SessionCheckpointEncodingError';
  }
}

const invalid = (): never => {
  throw new SessionCheckpointEncodingError();
};

const requireSecretFree = (value: string, secrets: readonly string[]): void => {
  if (secrets.some((secret) => secret.length > 0 && value.includes(secret))) invalid();
};

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const safeString = (value: unknown, maxBytes = 256): string => {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    encoder.encode(value).byteLength > maxBytes
  )
    return invalid();
  return value;
};

const containerOf = (value: unknown, secrets: readonly string[]): object | undefined => {
  if (value === null || typeof value === 'boolean') return undefined;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return invalid();
    return undefined;
  }
  if (typeof value === 'string') {
    requireSecretFree(value, secrets);
    return undefined;
  }
  if (typeof value !== 'object') return invalid();
  return value;
};

const objectValues = (value: object, secrets: readonly string[]): readonly unknown[] => {
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalid();
  const values: unknown[] = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || forbiddenKeys.has(key.toLowerCase())) return invalid();
    requireSecretFree(key, secrets);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor?.enumerable !== true || !Object.hasOwn(descriptor, 'value')) return invalid();
    values.push(descriptor.value);
  }
  return values;
};

const containerValues = (value: object, secrets: readonly string[]): readonly unknown[] => {
  if (!Array.isArray(value)) return objectValues(value, secrets);
  if (Object.getPrototypeOf(value) !== Array.prototype) return invalid();
  return value;
};

const inspectData = (source: unknown, secrets: readonly string[]): Readonly<JsonObject> => {
  if (!isJsonObject(source)) return invalid();
  const seen = new WeakSet<object>();
  const pending: Array<{ readonly depth: number; readonly value: unknown }> = [
    { depth: 1, value: source },
  ];
  let nodes = 0;
  for (let current = pending.pop(); current !== undefined; current = pending.pop()) {
    nodes += 1;
    if (nodes > 4_096 || current.depth > 32) return invalid();
    const container = containerOf(current.value, secrets);
    if (container === undefined) continue;
    if (seen.has(container)) return invalid();
    seen.add(container);
    for (const child of containerValues(container, secrets))
      pending.push({ depth: current.depth + 1, value: child });
  }
  try {
    return structuredClone(source);
  } catch {
    return invalid();
  }
};

const canonicalCheckpointBytes = (value: unknown): Uint8Array => {
  const encoded = canonicalize(value);
  if (typeof encoded !== 'string') return invalid();
  return encoder.encode(encoded);
};

const base64Url = (bytes: Uint8Array): string => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]!;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    output += alphabet[first >> 2];
    output += alphabet[((first & 3) << 4) | ((second ?? 0) >> 4)];
    if (second !== undefined) output += alphabet[((second & 15) << 2) | ((third ?? 0) >> 6)];
    if (third !== undefined) output += alphabet[third & 63];
  }
  return output;
};

export const encodeSessionContinuation = (options: {
  readonly acceptedTurnIds?: readonly string[];
  readonly continuation: SessionProtocolContinuation;
  readonly maxBytes: number;
  readonly secrets: readonly string[];
  readonly usageBaseline: AgentSessionUsage;
}): string => {
  const format = safeString(options.continuation.format);
  requireSecretFree(format, options.secrets);
  for (const turnId of options.acceptedTurnIds ?? []) requireSecretFree(turnId, options.secrets);
  const envelope: AgentSessionContinuationEnvelope = {
    ...(options.acceptedTurnIds === undefined ? {} : { acceptedTurnIds: options.acceptedTurnIds }),
    provider: {
      data: inspectData(options.continuation.data, options.secrets),
      format,
    },
    schemaVersion: 'agent-session-continuation-envelope/v1',
    usageBaseline: options.usageBaseline,
  };
  const bytes = canonicalCheckpointBytes(envelope);
  if (
    !Number.isSafeInteger(options.maxBytes) ||
    options.maxBytes < 1 ||
    bytes.byteLength > options.maxBytes
  )
    return invalid();
  return base64Url(bytes);
};

export const digestSessionContinuation = (value: unknown, digest: Sha256Digest): string =>
  digest.digest(canonicalCheckpointBytes(value));
