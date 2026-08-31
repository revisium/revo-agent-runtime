import type { AgentDefinitionInput } from '../../../src/index.js';
import { consumerSchemaDialect } from './consumer-schema.js';

export const agentDefinition = (
  overrides: Partial<AgentDefinitionInput> = {},
): AgentDefinitionInput => ({
  schemaVersion: 'agent-definition/v1',
  id: 'codex',
  version: '1.0.0',
  displayName: 'Codex',
  launch: {
    command: 'node',
    args: [{ kind: 'literal', value: 'bridge.mjs' }],
    versionProbe: { args: ['--version'], stream: 'stdout', timeoutMs: 1_000 },
  },
  protocol: { driver: 'acp/v1', permissionStrategy: 'acp/v1' },
  delivery: { prompt: 'protocol', resultSchema: 'protocol', result: 'protocol' },
  parameters: {
    schema: { $schema: consumerSchemaDialect, type: 'object' },
  },
  permissions: {
    schema: { $schema: consumerSchemaDialect, type: 'object' },
  },
  capabilities: { cancellation: true, structuredResult: true, usage: false },
  ...overrides,
});
