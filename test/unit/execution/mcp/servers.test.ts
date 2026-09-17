import { expect, test, vi } from 'vitest';

import {
  resolveMcpServers,
  resolvedMcpSecretValues,
  snapshotMcpServers,
} from '../../../../src/execution/mcp/servers.js';

const stdio = { name: 'knowledge', transport: 'stdio', command: 'revo', args: [] } as const;

test('captures MCP descriptors without retaining caller mutations', () => {
  const servers = [{ ...stdio, args: ['mcp'], env: { TOKEN: { environment: 'SESSION_TOKEN' } } }];
  const captured = snapshotMcpServers(servers);
  servers[0]!.args.push('changed');

  expect(captured?.[0]).toMatchObject({ args: ['mcp'] });
  expect(Object.isFrozen(captured?.[0])).toBe(true);
  expect(snapshotMcpServers(undefined)).toBeUndefined();
});

test('does not evaluate binding getters', () => {
  const getter = vi.fn(() => 'secret');
  const binding = Object.defineProperty({}, 'value', { enumerable: true, get: getter });

  expect(() => snapshotMcpServers([{ ...stdio, env: { TOKEN: binding } }])).toThrow();
  expect(getter).not.toHaveBeenCalled();
});

test.each([
  null,
  {},
  Array.from({ length: 33 }, (_, index) => ({ ...stdio, name: `server-${index}` })),
  [null],
  [{ ...stdio, extra: true }],
  [{ ...stdio, env: [] }],
  [
    {
      ...stdio,
      env: Object.fromEntries(
        Array.from({ length: 129 }, (_, index) => [`VAR_${index}`, { value: 'v' }]),
      ),
    },
  ],
  [{ ...stdio, env: { T: { value: 'a', environment: 'B' } } }],
  [{ ...stdio, args: 'mcp' }],
  [{ ...stdio, args: Array.from({ length: 129 }, () => 'arg') }],
  [{ name: 'knowledge', transport: 'sse' }],
  [{ name: 'knowledge', transport: 'http', url: 'file:///secret' }],
  [{ name: 'knowledge', transport: 'http', url: 'https://user@fixture/mcp' }],
  [{ name: 'knowledge', transport: 'http', url: 'https://:password@fixture/mcp' }],
  [stdio, stdio],
])('rejects unsupported, duplicate, or oversized MCP descriptors: %j', (value) => {
  expect(() => snapshotMcpServers(value)).toThrow();
});

test('resolves environment and literal bindings through one captured environment', () => {
  const servers = snapshotMcpServers([
    { ...stdio, env: { FIXTURE_MODE: { value: 'read-only' } } },
    {
      name: 'remote',
      transport: 'http',
      url: 'https://fixture/mcp',
      headers: { Authorization: { environment: 'TOKEN' } },
    },
    { name: 'public', transport: 'http', url: 'https://public-fixture/mcp' },
  ]);
  const resolved = resolveMcpServers(servers, { TOKEN: 'bound-token' });

  expect(resolved).toMatchObject([
    { env: { FIXTURE_MODE: { value: 'read-only' } } },
    { headers: { Authorization: { value: 'bound-token' } } },
    { headers: {} },
  ]);
  expect(resolvedMcpSecretValues(resolved)).toEqual(['read-only', 'bound-token']);
  expect(resolveMcpServers(undefined, {})).toBeUndefined();
  expect(resolvedMcpSecretValues(undefined)).toEqual([]);
});

test('unresolved environment bindings are not published as secret values', () => {
  const servers = snapshotMcpServers([
    stdio,
    { ...stdio, name: 'bound', env: { TOKEN: { environment: 'TOKEN' } } },
  ]);

  expect(resolvedMcpSecretValues(servers)).toEqual([]);
});

test('fails resolution for missing, inherited, or oversized environment bindings', () => {
  const servers = snapshotMcpServers([{ ...stdio, env: { TOKEN: { environment: 'TOKEN' } } }]);

  expect(() => resolveMcpServers(servers, {})).toThrow('Missing MCP environment binding.');
  expect(() => resolveMcpServers(servers, { TOKEN: 'x'.repeat(16_385) })).toThrow();
  expect(() =>
    resolveMcpServers(
      snapshotMcpServers([{ ...stdio, env: { TOKEN: { environment: 'toString' } } }]),
      {},
    ),
  ).toThrow('Missing MCP environment binding.');
});
