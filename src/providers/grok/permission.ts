import type * as acp from '@agentclientprotocol/sdk';

import type { AgentMcpServer } from '../../contracts/context.js';

const record = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Explicit exact-tool grants never authorize detached servers or persistent approvals. */
export const grokMcpPermission = (
  request: acp.RequestPermissionRequest,
  permissions: Readonly<Record<string, unknown>>,
  servers: readonly AgentMcpServer[],
): string | undefined => {
  const grants = permissions.mcpTools;
  const raw = request.toolCall.rawInput;
  if (
    !Array.isArray(grants) ||
    !grants.every(
      (name: unknown) =>
        typeof name === 'string' && /^[A-Za-z0-9_.-]+__[A-Za-z0-9_.-]+$/.test(name),
    ) ||
    !record(raw) ||
    raw.variant !== 'UseTool' ||
    typeof raw.tool_name !== 'string' ||
    !record(raw.tool_input)
  )
    return undefined;
  const name = raw.tool_name;
  if (!grants.includes(name)) return undefined;
  const attached = servers.filter(
    (server) => name.startsWith(`${server.name}__`) && name.length > server.name.length + 2,
  );
  if (attached.length !== 1) return undefined;
  return request.options.find((option) => option.kind === 'allow_once')?.optionId;
};
