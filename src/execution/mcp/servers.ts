import type { AgentMcpBinding, AgentMcpServer } from '../../contracts/context.js';
import { snapshotPlainJson } from '../output/plain-json-snapshot.js';

type Bindings = Readonly<Record<string, AgentMcpBinding>>;

const limits = Object.freeze({
  argumentBytes: 16_384,
  arguments: 128,
  bindingNameBytes: 256,
  bindingValueBytes: 16_384,
  bindings: 128,
  descriptorBytes: 262_144,
  nameBytes: 128,
  servers: 32,
});

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const exactObject = (
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Readonly<Record<string, unknown>> => {
  if (!isObject(value)) throw new TypeError('MCP descriptor object required.');
  const keys = Object.keys(value);
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    keys.some((key) => !required.includes(key) && !optional.includes(key))
  )
    throw new TypeError('Invalid MCP descriptor fields.');
  return value;
};

const text = (value: unknown, maximumBytes: number, allowEmpty = false): string => {
  if (
    typeof value !== 'string' ||
    (!allowEmpty && value.length === 0) ||
    value.includes('\0') ||
    new TextEncoder().encode(value).byteLength > maximumBytes
  )
    throw new TypeError('Invalid MCP descriptor text.');
  return value;
};

const binding = (candidate: unknown): AgentMcpBinding => {
  const value = exactObject(candidate, [], ['value', 'environment']);
  if (Object.keys(value).length !== 1)
    throw new TypeError('Exactly one MCP binding source is required.');
  return Object.freeze(
    Object.hasOwn(value, 'value')
      ? { value: text(value.value, limits.bindingValueBytes, true) }
      : { environment: text(value.environment, limits.bindingNameBytes) },
  );
};

const bindings = (value: unknown): Bindings => {
  if (!isObject(value)) throw new TypeError('Invalid MCP bindings.');
  const entries = Object.entries(value);
  if (entries.length > limits.bindings) throw new TypeError('Too many MCP bindings.');
  return Object.freeze(
    Object.fromEntries(
      entries.map(([name, candidate]) => [text(name, limits.bindingNameBytes), binding(candidate)]),
    ),
  );
};

const stdioServer = (input: Readonly<Record<string, unknown>>, name: string): AgentMcpServer => {
  exactObject(input, ['name', 'transport', 'command', 'args'], ['env']);
  if (!Array.isArray(input.args) || input.args.length > limits.arguments)
    throw new TypeError('Invalid MCP arguments.');
  return Object.freeze({
    name,
    transport: 'stdio',
    command: text(input.command, limits.argumentBytes),
    args: Object.freeze(input.args.map((arg: unknown) => text(arg, limits.argumentBytes, true))),
    ...(input.env === undefined ? {} : { env: bindings(input.env) }),
  });
};

const httpServer = (input: Readonly<Record<string, unknown>>, name: string): AgentMcpServer => {
  exactObject(input, ['name', 'transport', 'url'], ['headers']);
  const url = text(input.url, limits.argumentBytes);
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password)
    throw new TypeError('Invalid MCP URL.');
  return Object.freeze({
    name,
    transport: 'http',
    url,
    ...(input.headers === undefined ? {} : { headers: bindings(input.headers) }),
  });
};

const server = (value: unknown): AgentMcpServer => {
  const input = exactObject(
    value,
    ['name', 'transport'],
    ['command', 'args', 'env', 'url', 'headers'],
  );
  const name = text(input.name, limits.nameBytes);
  if (input.transport === 'stdio') return stdioServer(input, name);
  if (input.transport === 'http') return httpServer(input, name);
  throw new TypeError('Unsupported MCP transport.');
};

/** Copies caller MCP descriptors into bounded, frozen plain data with unresolved bindings. */
export const snapshotMcpServers = (value: unknown): readonly AgentMcpServer[] | undefined => {
  if (value === undefined) return undefined;
  const input = snapshotPlainJson(value, limits.descriptorBytes);
  if (!Array.isArray(input) || input.length > limits.servers)
    throw new TypeError('Invalid MCP server list.');
  const servers = input.map(server);
  if (new Set(servers.map((entry) => entry.name)).size !== servers.length)
    throw new TypeError('Duplicate MCP server names.');
  return Object.freeze(servers);
};

const resolveBindings = (
  entries: Bindings | undefined,
  environment: Readonly<Record<string, string>>,
): Bindings =>
  Object.freeze(
    Object.fromEntries(
      Object.entries(entries ?? {}).map(([name, source]) => {
        const value =
          'value' in source
            ? source.value
            : Object.hasOwn(environment, source.environment)
              ? environment[source.environment]
              : undefined;
        if (value === undefined) throw new TypeError('Missing MCP environment binding.');
        return [name, Object.freeze({ value })];
      }),
    ),
  );

/** Replaces environment bindings with captured launch values; every value stays bounded. */
export const resolveMcpServers = (
  servers: readonly AgentMcpServer[] | undefined,
  environment: Readonly<Record<string, string>>,
): readonly AgentMcpServer[] | undefined => {
  if (servers === undefined) return undefined;
  return snapshotMcpServers(
    servers.map((entry) =>
      entry.transport === 'stdio'
        ? { ...entry, env: resolveBindings(entry.env, environment) }
        : { ...entry, headers: resolveBindings(entry.headers, environment) },
    ),
  );
};

const bindingValues = (entries: Bindings | undefined): readonly string[] =>
  Object.values(entries ?? {}).flatMap((source) => ('value' in source ? [source.value] : []));

/** Every resolved env or header value joins the incarnation redaction set. */
export const resolvedMcpSecretValues = (
  servers: readonly AgentMcpServer[] | undefined,
): readonly string[] =>
  (servers ?? []).flatMap((entry) =>
    bindingValues(entry.transport === 'stdio' ? entry.env : entry.headers),
  );
