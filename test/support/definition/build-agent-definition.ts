import type {
  ActiveInvocationStateSink,
  ActiveStateOperationContext,
  AgentDefinitionInput,
  AgentManagerOptions,
  JsonSchema202012,
} from '../../../src/runtime/spec/index.js';

export type RecordingActiveStateSink = ActiveInvocationStateSink & {
  readonly calls: readonly string[];
  rejectNext(): void;
  hangNext(): void;
};

export const createTestActiveStateSink = (): ActiveInvocationStateSink =>
  Object.freeze({
    save: async (): Promise<void> => undefined,
    remove: async (): Promise<void> => undefined,
  });

export const createRecordingActiveStateSink = (): RecordingActiveStateSink => {
  const calls: string[] = [];
  const outcomes: Array<'reject' | 'hang'> = [];
  return {
    calls,
    rejectNext: () => outcomes.push('reject'),
    hangNext: () => outcomes.push('hang'),
    save: async (): Promise<void> => undefined,
    remove: async (invocationId: string, _context: ActiveStateOperationContext): Promise<void> => {
      calls.push(invocationId);
      const outcome = outcomes.shift();
      if (outcome === 'reject') throw new Error('remove failed');
      if (outcome === 'hang') await new Promise<void>(() => undefined);
    },
  };
};

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

export const buildAgentManagerOptions = (
  overrides: Partial<AgentManagerOptions> = {},
): AgentManagerOptions => ({
  activeStateSink: createTestActiveStateSink(),
  definitions: [buildAgentDefinition()],
  ...overrides,
});
