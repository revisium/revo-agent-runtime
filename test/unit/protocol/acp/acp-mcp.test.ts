import { expect, test } from 'vitest';

import { AcpMcpCapabilityError, acpMcpServers } from '../../../../src/protocol/acp/mcp.js';

test('stdio servers map resolved env pairs without requiring HTTP capability', () => {
  expect(
    acpMcpServers(
      [
        {
          args: ['mcp'],
          command: 'revo',
          env: { MODE: { value: 'read-only' } },
          name: 'knowledge',
          transport: 'stdio',
        },
      ],
      {},
    ),
  ).toEqual([
    {
      args: ['mcp'],
      command: 'revo',
      env: [{ name: 'MODE', value: 'read-only' }],
      name: 'knowledge',
    },
  ]);
});

test('HTTP servers require the advertised capability and map resolved headers', () => {
  expect(() =>
    acpMcpServers([{ name: 'remote', transport: 'http', url: 'https://fixture/mcp' }], {}),
  ).toThrow(AcpMcpCapabilityError);

  expect(
    acpMcpServers(
      [
        {
          headers: { Authorization: { value: 'fixture-token' } },
          name: 'remote',
          transport: 'http',
          url: 'https://fixture/mcp',
        },
      ],
      { mcpCapabilities: { http: true } },
    ),
  ).toEqual([
    {
      headers: [{ name: 'Authorization', value: 'fixture-token' }],
      name: 'remote',
      type: 'http',
      url: 'https://fixture/mcp',
    },
  ]);
});

test('refuses to map unresolved environment bindings onto the wire', () => {
  expect(() =>
    acpMcpServers(
      [
        {
          args: [],
          command: 'revo',
          env: { TOKEN: { environment: 'TOKEN' } },
          name: 'knowledge',
          transport: 'stdio',
        },
      ],
      {},
    ),
  ).toThrow('Unresolved MCP binding.');
});
