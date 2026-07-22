import type { AgentDefinitionInput, JsonSchema202012 } from '../../../src/runtime/spec/index.js';

export const p1ObjectSchema: JsonSchema202012 = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
};

export const buildAgentDefinition = (
  overrides: Partial<AgentDefinitionInput> = {},
): AgentDefinitionInput => ({
  schemaVersion: 'agent-definition/v1',
  id: 'fixture-agent',
  version: '1.0.0',
  displayName: 'Fixture Agent',
  launch: {
    command: '/fixture/bin/agent',
    args: [{ kind: 'prompt' }, { kind: 'result-schema' }],
    versionProbe: { args: ['--version'], stream: 'stdout', prefix: 'agent ', timeoutMs: 1_000 },
  },
  protocol: {
    driver: 'native/stdio-v1',
    resultParser: 'codex-jsonl/v1',
    permissionStrategy: 'codex-cli/v1',
  },
  delivery: { prompt: 'argument', resultSchema: 'argument', result: 'stdout' },
  parameters: { schema: p1ObjectSchema, defaults: {} },
  permissions: { schema: p1ObjectSchema, defaults: {} },
  capabilities: { cancellation: true, structuredResult: true, usage: true },
  constraints: { platforms: ['linux'], executableVersion: '>=1.0.0 <2.0.0' },
  ...overrides,
});
