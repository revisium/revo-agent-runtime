import canonicalize from 'canonicalize';

import { AgentManagerError } from '../../errors/index.js';
import { AGENT_FAULT_MESSAGES } from '../../policy/index.js';
import type { AgentFault, JsonValue } from '../../spec/index.js';
import { inspectPlainJson } from '../plain-json/index.js';

const textEncoder = new TextEncoder();

const createInternalConstructionFault = (): AgentFault => ({
  code: 'revo.agent.internal',
  message: AGENT_FAULT_MESSAGES.internalConstruction,
  phase: 'construction',
  retryable: false,
});

const throwInternalConstructionFault = (): never => {
  throw new AgentManagerError(createInternalConstructionFault());
};

const isEnumerableDataDescriptor = (
  descriptor: PropertyDescriptor | undefined,
): descriptor is PropertyDescriptor & { readonly enumerable: true; readonly value: unknown } =>
  descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');

const copyDataProperty = (container: object, key: string): JsonValue => {
  const descriptor = Object.getOwnPropertyDescriptor(container, key);
  if (isEnumerableDataDescriptor(descriptor)) return copyPlainJson(descriptor.value);

  return throwInternalConstructionFault();
};

const shadowInheritedToJson = (container: object): void => {
  Object.defineProperty(container, 'toJSON', {
    configurable: true,
    enumerable: false,
    value: undefined,
    writable: true,
  });
};

const copyPlainJsonArray = (value: readonly unknown[]): JsonValue => {
  const copy: JsonValue[] = [];
  shadowInheritedToJson(copy);

  for (let index = 0; index < value.length; index += 1) {
    copy.push(copyDataProperty(value, String(index)));
  }

  return copy;
};

const copyPlainJsonObject = (value: object): JsonValue => {
  const copy: { [key: string]: JsonValue } = {};
  shadowInheritedToJson(copy);

  for (const key of Object.keys(value)) {
    Object.defineProperty(copy, key, {
      configurable: true,
      enumerable: true,
      value: copyDataProperty(value, key),
      writable: true,
    });
  }

  return copy;
};

const copyPlainJson = (value: unknown): JsonValue => {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  )
    return value;
  if (Array.isArray(value)) return copyPlainJsonArray(value);
  if (typeof value === 'object') return copyPlainJsonObject(value);

  return throwInternalConstructionFault();
};

const canonicalizeCopy = (value: JsonValue): string => {
  let canonicalJson: string | undefined;

  try {
    canonicalJson = canonicalize(value);
  } catch {
    return throwInternalConstructionFault();
  }

  return canonicalJson ?? throwInternalConstructionFault();
};

export const canonicalizeJsonBytes = (value: JsonValue): Uint8Array => {
  inspectPlainJson(value, '/definition');
  return textEncoder.encode(canonicalizeCopy(copyPlainJson(value)));
};
