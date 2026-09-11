import type {
  AgentConfigurationSelection,
  AgentConfigurationSelectionValue,
} from '../contracts/configuration.js';

const textEncoder = new TextEncoder();

const isPlainObject = (value: unknown): value is object => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Reflect.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const utf8ByteLength = (value: string): number | undefined => {
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.codePointAt(index)!;
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) return undefined;
    if (codePoint > 0xffff) index += 1;
  }
  return textEncoder.encode(value).byteLength;
};

const boundedString = (value: unknown, maximumBytes: number): string => {
  if (typeof value !== 'string' || value.length === 0)
    throw new TypeError('Bounded string required.');
  const bytes = utf8ByteLength(value);
  if (bytes === undefined || bytes > maximumBytes) throw new TypeError('Bounded string required.');
  return value;
};

const readOwnDataProperties = (value: object): Readonly<Record<string, unknown>> => {
  const keys = Reflect.ownKeys(value);
  const copy: Record<string, unknown> = {};
  for (const key of keys) {
    if (typeof key !== 'string') throw new TypeError('String keys required.');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor?.enumerable !== true || !Object.hasOwn(descriptor, 'value'))
      throw new TypeError('Enumerable data properties required.');
    Object.defineProperty(copy, key, {
      configurable: true,
      enumerable: true,
      value: descriptor.value,
      writable: true,
    });
  }
  return copy;
};

const exactTopLevel = (value: unknown): Readonly<Record<string, unknown>> => {
  if (!isPlainObject(value)) throw new TypeError('Plain object required.');
  const copy = readOwnDataProperties(value);
  const keys = Object.keys(copy);
  if (
    !Object.hasOwn(copy, 'selections') ||
    keys.some((key) => key !== 'selections' && key !== 'catalogRevision')
  )
    throw new TypeError('Invalid configuration selection keys.');
  return copy;
};

const copySelectionValue = (
  target: Record<string, AgentConfigurationSelectionValue>,
  key: string,
  value: unknown,
): void => {
  if (key.length === 0 || (utf8ByteLength(key) ?? Number.MAX_SAFE_INTEGER) > 256)
    throw new TypeError('Invalid configuration id.');
  if (typeof value === 'boolean') {
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
    return;
  }
  if (typeof value !== 'string' || (utf8ByteLength(value) ?? Number.MAX_SAFE_INTEGER) > 4_096)
    throw new TypeError('Invalid configuration value.');
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
};

const copySelections = (
  value: unknown,
): Readonly<Record<string, AgentConfigurationSelectionValue>> => {
  if (!isPlainObject(value)) throw new TypeError('Plain object required.');
  const source = readOwnDataProperties(value);
  const keys = Object.keys(source);
  if (keys.length > 128) throw new TypeError('Too many configuration selections.');
  const copy: Record<string, AgentConfigurationSelectionValue> = {};
  for (const key of keys) {
    copySelectionValue(copy, key, source[key]);
  }
  return Object.freeze(copy);
};

const decodeSelection = (value: unknown): AgentConfigurationSelection => {
  const input = exactTopLevel(value);
  const revision = Object.hasOwn(input, 'catalogRevision')
    ? boundedString(input.catalogRevision, 128)
    : undefined;
  const selections = copySelections(input.selections);
  return Object.freeze({
    ...(revision === undefined ? {} : { catalogRevision: revision }),
    selections,
  });
};

export const decodeAgentConfigurationSelection = (value: unknown): AgentConfigurationSelection => {
  try {
    return decodeSelection(value);
  } catch (error: unknown) {
    if (error instanceof TypeError) throw error;
    throw new TypeError('Invalid configuration selection.', { cause: error });
  }
};
