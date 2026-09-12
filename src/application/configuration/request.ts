import type { InspectAgentConfiguration } from '../../contracts/configuration.js';

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

const boundedString = (value: unknown, maximum: number): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum)
    throw new TypeError('Bounded string required.');
  return value;
};

const agentRef = (value: unknown) => {
  const agent = exactRecord(
    value,
    ['id', 'version', 'installationId'],
    ['id', 'version', 'installationId'],
  );
  return Object.freeze({
    id: boundedString(agent.id, 256),
    version: boundedString(agent.version, 256),
    installationId: boundedString(agent.installationId, 16_384),
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
