import type { AgentDefinitionInput } from '../contracts/agent-definition.js';

const dialect = 'https://json-schema.org/draft/2020-12/schema';

export interface AcpDefinitionDetails {
  readonly args: readonly string[];
  readonly command: string;
  readonly displayName: string;
  readonly id: string;
  readonly version: string;
  readonly versionProbeArgs?: readonly string[];
  readonly versionProbePrefix?: string;
  readonly versionProbeTimeoutMs?: number;
}

/** Creates the shared, provider-neutral ACP definition shape. */
export const acpDefinition = ({
  args,
  command,
  displayName,
  id,
  version,
  versionProbeArgs = ['--version'],
  versionProbePrefix,
  versionProbeTimeoutMs = 1_000,
}: AcpDefinitionDetails): AgentDefinitionInput => ({
  schemaVersion: 'agent-definition/v1',
  id,
  version,
  displayName,
  launch: {
    command,
    args: args.map((value) => ({ kind: 'literal', value })),
    versionProbe: {
      args: versionProbeArgs,
      ...(versionProbePrefix === undefined ? {} : { prefix: versionProbePrefix }),
      stream: 'stdout',
      timeoutMs: versionProbeTimeoutMs,
    },
  },
  protocol: { driver: 'acp/v1', permissionStrategy: 'acp/v1' },
  delivery: { prompt: 'protocol', resultSchema: 'protocol', result: 'protocol' },
  parameters: { schema: { $schema: dialect, type: 'object' } },
  permissions: { schema: { $schema: dialect, type: 'object' } },
  capabilities: {
    cancellation: true,
    session: {
      interactions: { input: true, permission: true },
      multiTurn: true,
      resume: 'none',
      updates: { message: true, plan: true, progress: false, tool: true, usage: true },
    },
    structuredResult: true,
    usage: true,
  },
});
