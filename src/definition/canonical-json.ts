import { types as utilTypes } from 'node:util';

import canonicalize from 'canonicalize';

import type { JsonObject, JsonValue } from '../contracts/agent-definition.js';

const textEncoder = new TextEncoder();

type MutableJsonObject = { [key: string]: JsonValue };
type JsonContainer = MutableJsonObject | JsonValue[];

interface JsonInspection<T extends JsonValue = JsonValue> {
  readonly copy: T;
  readonly depth: number;
  readonly nodes: number;
}

interface JsonProperty {
  readonly key: string;
  readonly value: unknown;
}

interface EnterFrame {
  readonly kind: 'enter';
  readonly source: unknown;
  readonly target: JsonContainer | undefined;
  readonly targetKey: string;
  readonly depth: number;
}

interface ExitFrame {
  readonly kind: 'exit';
  readonly source: object;
}

type TraversalFrame = EnterFrame | ExitFrame;

class CanonicalJsonError extends Error {
  constructor() {
    super('Value is not canonical JSON.');
    this.name = 'CanonicalJsonError';
  }
}

const invalidJson = (): never => {
  throw new CanonicalJsonError();
};

const hasPairedSurrogates = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const trailing = value.charCodeAt(index + 1);
      if (!(trailing >= 0xdc00 && trailing <= 0xdfff)) return false;
      index += 1;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return false;
  }
  return true;
};

const isEnumerableDataDescriptor = (
  descriptor: PropertyDescriptor | undefined,
): descriptor is PropertyDescriptor & { readonly enumerable: true; readonly value: unknown } =>
  descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');

const dataProperty = (container: object, key: string): JsonProperty => {
  if (!hasPairedSurrogates(key)) return invalidJson();
  const descriptor = Object.getOwnPropertyDescriptor(container, key);
  if (!isEnumerableDataDescriptor(descriptor)) return invalidJson();
  return { key, value: descriptor.value };
};

const objectProperties = (source: object): readonly JsonProperty[] => {
  if (utilTypes.isProxy(source)) return invalidJson();
  const prototype: unknown = Object.getPrototypeOf(source);
  if (prototype !== Object.prototype && prototype !== null) return invalidJson();

  const properties: JsonProperty[] = [];
  for (const key of Reflect.ownKeys(source)) {
    if (typeof key !== 'string') return invalidJson();
    properties.push(dataProperty(source, key));
  }
  return properties;
};

const arrayProperties = (source: readonly unknown[]): readonly JsonProperty[] => {
  if (utilTypes.isProxy(source) || Object.getPrototypeOf(source) !== Array.prototype)
    return invalidJson();
  const length = source.length;

  const keys = Reflect.ownKeys(source);
  if (keys.length !== length + 1 || keys[length] !== 'length') return invalidJson();

  const properties: JsonProperty[] = [];
  for (let index = 0; index < length; index += 1) {
    const key = String(index);
    properties.push(dataProperty(source, key));
  }
  return properties;
};

const shadowInheritedToJson = (container: object): void => {
  Object.defineProperty(container, 'toJSON', {
    configurable: true,
    enumerable: false,
    value: undefined,
    writable: true,
  });
};

const assignCopy = (
  target: JsonContainer | undefined,
  targetKey: string,
  value: JsonValue,
  assignRoot: (value: JsonValue) => void,
): void => {
  if (target === undefined) {
    assignRoot(value);
    return;
  }
  if (Array.isArray(target)) {
    target.push(value);
    return;
  }
  Object.defineProperty(target, targetKey, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
};

const enterContainer = (
  frame: EnterFrame,
  source: object,
  activeContainers: WeakSet<object>,
  frames: TraversalFrame[],
  assignRoot: (value: JsonValue) => void,
): void => {
  if (activeContainers.has(source)) return invalidJson();

  const isArray = Array.isArray(source);
  const properties = isArray ? arrayProperties(source) : objectProperties(source);
  const target: JsonContainer = isArray ? [] : {};
  shadowInheritedToJson(target);
  assignCopy(frame.target, frame.targetKey, target, assignRoot);

  activeContainers.add(source);
  frames.push({ kind: 'exit', source });
  for (const property of properties.toReversed()) {
    frames.push({
      kind: 'enter',
      source: property.value,
      target,
      targetKey: isArray ? '' : property.key,
      depth: frame.depth + 1,
    });
  }
};

export function inspectAndCopyPlainJson(value: JsonObject): JsonInspection<JsonObject>;
export function inspectAndCopyPlainJson(value: JsonValue): JsonInspection;
export function inspectAndCopyPlainJson(value: unknown): JsonInspection;
export function inspectAndCopyPlainJson(value: unknown): JsonInspection {
  const activeContainers = new WeakSet<object>();
  const frames: TraversalFrame[] = [
    { kind: 'enter', source: value, target: undefined, targetKey: '', depth: 1 },
  ];
  let copy: JsonValue = null;
  let depth = 1;
  let nodes = 0;
  const assignRoot = (next: JsonValue): void => {
    copy = next;
  };

  for (let frame = frames.pop(); frame !== undefined; frame = frames.pop()) {
    if (frame.kind === 'exit') {
      activeContainers.delete(frame.source);
      continue;
    }

    nodes += 1;
    depth = Math.max(depth, frame.depth);
    const { source } = frame;
    if (source === null || typeof source === 'boolean') {
      assignCopy(frame.target, frame.targetKey, source, assignRoot);
      continue;
    }
    if (typeof source === 'string') {
      if (!hasPairedSurrogates(source)) return invalidJson();
      assignCopy(frame.target, frame.targetKey, source, assignRoot);
      continue;
    }
    if (typeof source === 'number') {
      if (!Number.isFinite(source)) return invalidJson();
      assignCopy(frame.target, frame.targetKey, source, assignRoot);
      continue;
    }
    if (typeof source === 'object') {
      enterContainer(frame, source, activeContainers, frames, assignRoot);
      continue;
    }
    return invalidJson();
  }

  return { copy, depth, nodes };
}

export const canonicalizeCopiedJsonBytes = (value: JsonValue): Uint8Array => {
  return textEncoder.encode(String(canonicalize(value)));
};

export const canonicalizeJsonBytes = (value: unknown): Uint8Array => {
  const inspection = inspectAndCopyPlainJson(value);
  return canonicalizeCopiedJsonBytes(inspection.copy);
};

export const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
