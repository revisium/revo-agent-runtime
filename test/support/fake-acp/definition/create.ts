import type { AgentDefinitionInput } from '../../../../src/index.js';
import { fakeAcpLaunch } from './launch.js';
import type { FakeAcpDefinitionOptions } from './options.js';

const schemaDialect = 'https://json-schema.org/draft/2020-12/schema';
export const fakeAcpAgentDefinition = (
  options: FakeAcpDefinitionOptions = {},
): AgentDefinitionInput => ({
  schemaVersion: 'agent-definition/v1',
  id: options.id ?? 'codex',
  version: '1.0.0',
  displayName: options.displayName ?? 'Codex',
  launch: fakeAcpLaunch(options),
  protocol: { driver: 'acp/v1', permissionStrategy: 'acp/v1' },
  delivery: { prompt: 'protocol', resultSchema: 'protocol', result: 'protocol' },
  parameters: { schema: { $schema: schemaDialect, type: 'object' } },
  permissions: { schema: { $schema: schemaDialect, type: 'object' } },
  capabilities: {
    cancellation: true,
    ...(options.mode === 'session' || options.session === true
      ? {
          session: {
            interactions: { input: false, permission: false },
            multiTurn: true as const,
            resume: 'none' as const,
            updates: {
              message: true as const,
              plan: false,
              progress: false,
              tool: false,
              usage: false,
            },
          },
        }
      : {}),
    structuredResult: true,
    usage: options.usage ?? false,
  },
});
