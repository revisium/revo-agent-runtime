import type { AgentMcpServer } from '../../../../contracts/context.js';
import { AgentManagerError } from '../../../../contracts/manager/core.js';
import { resolveMcpServers, resolvedMcpSecretValues } from '../../../../execution/mcp/servers.js';

export interface ResolvedSessionMcpServers {
  readonly servers?: readonly AgentMcpServer[];
  /** Resolved binding values that must never appear in published session output. */
  readonly secrets: readonly string[];
}

/** Binds MCP descriptors to the captured launch environment before any process exists. */
export const resolveSessionMcpServers = (
  servers: readonly AgentMcpServer[] | undefined,
  environment: Readonly<Record<string, string>>,
): ResolvedSessionMcpServers => {
  try {
    const resolved = resolveMcpServers(servers, environment);
    return Object.freeze({
      ...(resolved === undefined ? {} : { servers: resolved }),
      secrets: resolvedMcpSecretValues(resolved),
    });
  } catch {
    throw new AgentManagerError(
      Object.freeze({
        code: 'revo.agent.parameters_invalid',
        message: 'MCP environment binding is unavailable.',
        phase: 'session_opening',
        retryable: false,
      }),
    );
  }
};
