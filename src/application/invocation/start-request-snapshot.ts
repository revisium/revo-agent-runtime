import { AgentManagerError, type StartAgentInvocation } from '../../contracts/manager.js';
import { snapshotPlainJsonObject } from '../../execution/output/plain-json-snapshot.js';
import { snapshotConfigurationSelection } from '../configuration/request.js';
import { fault } from '../faults/agent-faults.js';

const requestKeys = [
  'agent',
  'configuration',
  'invocationId',
  'limits',
  'metadata',
  'output',
  'parameters',
  'permissions',
  'prompt',
  'result',
  'workspace',
] as const;
const limitKeys = [
  'idleTimeoutMs',
  'maxEventBytes',
  'maxEventsFileBytes',
  'maxRawResponseBytes',
  'maxStderrBytes',
  'maxStdoutBytes',
  'wallClockTimeoutMs',
] as const;

const utf8Bytes = (value: string): number | undefined => {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.codePointAt(index)!;
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) return undefined;
    if (codePoint <= 0x7f) bytes += 1;
    else if (codePoint <= 0x7ff) bytes += 2;
    else if (codePoint <= 0xffff) bytes += 3;
    else bytes += 4;
    if (codePoint > 0xffff) index += 1;
  }
  return bytes;
};

const exactDataObject = (
  value: unknown,
  allowed: readonly string[],
  required: readonly string[],
): Readonly<Record<string, unknown>> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new TypeError('Object required.');
  const prototype = Reflect.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new TypeError('Plain object required.');
  const keys = Reflect.ownKeys(value);
  const stringKeys: string[] = [];
  for (const key of keys) {
    if (typeof key !== 'string' || !allowed.includes(key))
      throw new TypeError('Invalid object keys.');
    stringKeys.push(key);
  }
  if (required.some((key) => !stringKeys.includes(key)))
    throw new TypeError('Invalid object keys.');
  const result: Record<string, unknown> = {};
  for (const key of stringKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor?.enumerable !== true || !Object.hasOwn(descriptor, 'value'))
      throw new TypeError('Data property required.');
    result[key] = descriptor.value;
  }
  return result;
};

const boundedString = (value: unknown, maximumBytes: number): string => {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    (utf8Bytes(value) ?? maximumBytes + 1) > maximumBytes
  )
    throw new TypeError('Invalid bounded string.');
  return value;
};

const snapshotAgent = (value: unknown): StartAgentInvocation['agent'] => {
  const agent = exactDataObject(value, ['id', 'version'], ['id', 'version']);
  return Object.freeze({
    id: boundedString(agent.id, 256),
    version: boundedString(agent.version, 256),
  });
};

const snapshotDirectory = (
  value: unknown,
  maximumBytes: number,
): { readonly directory: string } => {
  const directory = exactDataObject(value, ['directory'], ['directory']);
  return Object.freeze({ directory: boundedString(directory.directory, maximumBytes) });
};

const snapshotLimits = (value: unknown): StartAgentInvocation['limits'] | undefined => {
  if (value === undefined) return undefined;
  const input = exactDataObject(value, limitKeys, []);
  const limits: Record<string, number> = {};
  for (const [key, limit] of Object.entries(input)) {
    if (!Number.isSafeInteger(limit)) throw new TypeError('Invalid invocation limit.');
    limits[key] = Number(limit);
  }
  return Object.freeze(limits);
};

const snapshotRecord = (value: unknown, maximumBytes: number) =>
  snapshotPlainJsonObject(value, maximumBytes);

export const snapshotStartRequest = (value: unknown): StartAgentInvocation => {
  try {
    const input = exactDataObject(value, requestKeys, [
      'agent',
      'invocationId',
      'output',
      'parameters',
      'permissions',
      'prompt',
      'result',
      'workspace',
    ]);
    const result = exactDataObject(input.result, ['schema'], ['schema']);
    const limits = snapshotLimits(input.limits);
    const configuration = snapshotConfigurationSelection(input.configuration);
    const metadata =
      input.metadata === undefined ? undefined : snapshotRecord(input.metadata, 65_536);
    return Object.freeze({
      agent: snapshotAgent(input.agent),
      ...(configuration === undefined ? {} : { configuration }),
      invocationId: boundedString(input.invocationId, 256),
      ...(limits === undefined ? {} : { limits }),
      ...(metadata === undefined ? {} : { metadata }),
      output: snapshotDirectory(input.output, 16_384),
      parameters: snapshotRecord(input.parameters, 262_144),
      permissions: snapshotRecord(input.permissions, 262_144),
      prompt: boundedString(input.prompt, 4_194_304),
      result: Object.freeze({ schema: snapshotRecord(result.schema, 1_048_576) }),
      workspace: snapshotDirectory(input.workspace, 16_384),
    });
  } catch {
    throw new AgentManagerError(
      fault('revo.agent.definition_invalid', 'Agent invocation request is invalid.', 'preflight'),
    );
  }
};
