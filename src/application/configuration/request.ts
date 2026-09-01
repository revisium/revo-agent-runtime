import type {
  AgentConfigurationSelection,
  InspectAgentConfiguration,
} from '../../contracts/configuration.js';

const isPlainRecord = (value: unknown): value is Readonly<Record<string, unknown>> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Reflect.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const exactRecord = (
  value: unknown,
  allowed: readonly string[],
  required: readonly string[],
): Readonly<Record<string, unknown>> => {
  if (!isPlainRecord(value)) throw new TypeError('Plain object required.');
  const keys = Reflect.ownKeys(value);
  const copy: Record<string, unknown> = {};
  for (const key of keys) {
    if (typeof key !== 'string' || !allowed.includes(key))
      throw new TypeError('Invalid object keys.');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor?.enumerable !== true || !Object.hasOwn(descriptor, 'value'))
      throw new TypeError('Data property required.');
    copy[key] = descriptor.value;
  }
  if (required.some((key) => !Object.hasOwn(copy, key)))
    throw new TypeError('Invalid object keys.');
  return copy;
};

const dataRecord = (value: unknown): Readonly<Record<string, unknown>> => {
  if (!isPlainRecord(value)) throw new TypeError('Plain object required.');
  const copy: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') throw new TypeError('String key required.');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor?.enumerable !== true || !Object.hasOwn(descriptor, 'value'))
      throw new TypeError('Data property required.');
    copy[key] = descriptor.value;
  }
  return copy;
};

const boundedString = (value: unknown, maximum: number): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum)
    throw new TypeError('Bounded string required.');
  return value;
};

const agentRef = (value: unknown) => {
  const agent = exactRecord(value, ['id', 'version'], ['id', 'version']);
  return Object.freeze({
    id: boundedString(agent.id, 256),
    version: boundedString(agent.version, 256),
  });
};

const workspace = (value: unknown) => {
  const input = exactRecord(value, ['directory'], ['directory']);
  return Object.freeze({ directory: boundedString(input.directory, 16_384) });
};

export const snapshotConfigurationInspection = (value: unknown): InspectAgentConfiguration => {
  const input = exactRecord(value, ['agent', 'workspace'], ['agent', 'workspace']);
  return Object.freeze({ agent: agentRef(input.agent), workspace: workspace(input.workspace) });
};

export const snapshotConfigurationSelection = (
  value: unknown,
): AgentConfigurationSelection | undefined => {
  if (value === undefined) return undefined;
  const input = exactRecord(value, ['catalogRevision', 'selections'], ['selections']);
  const source = dataRecord(input.selections);
  const keys = Object.keys(source);
  if (keys.length > 128) throw new TypeError('Too many configuration selections.');
  const selections: Record<string, boolean | string> = {};
  for (const key of keys) {
    if (typeof key !== 'string' || key.length === 0 || key.length > 256)
      throw new TypeError('Invalid configuration id.');
    const selected = source[key];
    if (typeof selected !== 'boolean' && (typeof selected !== 'string' || selected.length > 4_096))
      throw new TypeError('Invalid configuration value.');
    selections[key] = selected;
  }
  const revision =
    input.catalogRevision === undefined ? undefined : boundedString(input.catalogRevision, 128);
  return Object.freeze({
    ...(revision === undefined ? {} : { catalogRevision: revision }),
    selections: Object.freeze(selections),
  });
};
