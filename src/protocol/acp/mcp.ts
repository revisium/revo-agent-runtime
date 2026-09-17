import type * as acp from '@agentclientprotocol/sdk';

import type { AgentMcpBinding, AgentMcpServer } from '../../contracts/context.js';

export class AcpMcpCapabilityError extends Error {
  constructor(transport: string) {
    super(`ACP agent does not advertise the ${transport} MCP transport.`);
    this.name = 'AcpMcpCapabilityError';
  }
}

const pairs = (bindings: Readonly<Record<string, AgentMcpBinding>> = {}) =>
  Object.entries(bindings).map(([name, binding]) => {
    if (!('value' in binding)) throw new TypeError('Unresolved MCP binding.');
    return { name, value: binding.value };
  });

/** Maps resolved descriptors onto ACP servers; HTTP requires the advertised capability. */
export const acpMcpServers = (
  servers: readonly AgentMcpServer[] = [],
  capabilities: acp.AgentCapabilities | null | undefined,
): acp.McpServer[] =>
  servers.map((server) => {
    if (server.transport === 'stdio')
      return {
        name: server.name,
        command: server.command,
        args: [...server.args],
        env: pairs(server.env),
      };
    if (capabilities?.mcpCapabilities?.http !== true) throw new AcpMcpCapabilityError('http');
    return { name: server.name, type: 'http', url: server.url, headers: pairs(server.headers) };
  });
