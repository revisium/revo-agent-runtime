import { expect, test } from 'vitest';

import {
  DefinitionValidationError,
  validateAgentDefinition,
} from '../../../src/definition/index.js';
import { agentDefinition } from '../../support/builders/agent-definition.js';

const invalidCases: readonly {
  readonly name: string;
  readonly input: () => unknown;
  readonly code: 'definition_invalid' | 'strategy_unsupported';
}[] = [
  {
    name: 'unknown top-level field',
    input: () => ({ ...agentDefinition(), unexpected: true }),
    code: 'definition_invalid',
  },
  {
    name: 'unknown protocol driver',
    input: () =>
      agentDefinition({ protocol: { driver: 'future/v2', permissionStrategy: 'acp/v1' } }),
    code: 'strategy_unsupported',
  },
  {
    name: 'unknown permission strategy',
    input: () =>
      agentDefinition({ protocol: { driver: 'acp/v1', permissionStrategy: 'future/v2' } }),
    code: 'strategy_unsupported',
  },
  {
    name: 'unknown result parser',
    input: () =>
      agentDefinition({
        protocol: { driver: 'acp/v1', resultParser: 'future/v2', permissionStrategy: 'acp/v1' },
      }),
    code: 'strategy_unsupported',
  },
  {
    name: 'invalid ACP delivery',
    input: () =>
      agentDefinition({
        delivery: { prompt: 'stdin', resultSchema: 'protocol', result: 'protocol' },
      }),
    code: 'strategy_unsupported',
  },
  {
    name: 'non-object parameter schema',
    input: () => ({ ...agentDefinition(), parameters: { schema: [] } }),
    code: 'definition_invalid',
  },
];

test('validates the v1 definition contract and narrows supported protocol identifiers', () => {
  const validated = validateAgentDefinition(agentDefinition({ displayName: 'Codex 😀' }));
  expect(validated.definition.protocol).toEqual({ driver: 'acp/v1', permissionStrategy: 'acp/v1' });
  expect(validated.definition.schemaVersion).toBe('agent-definition/v1');
  expect(validated.digest).toMatch(/^[0-9a-f]{64}$/);
});

test.each(invalidCases)('rejects $name with a typed error', ({ input, code }) => {
  expect(() => validateAgentDefinition(input())).toThrow(DefinitionValidationError);
  try {
    validateAgentDefinition(input());
  } catch (error: unknown) {
    if (!(error instanceof DefinitionValidationError)) throw error;
    expect(error.code).toBe(code);
  }
});

test.each([
  {
    name: 'a Codex native definition',
    definition: agentDefinition({
      launch: {
        ...agentDefinition().launch,
        args: [
          { kind: 'prompt' },
          { kind: 'result-schema-file' },
          { kind: 'permission', name: 'write', omitIfMissing: true },
        ],
      },
      protocol: {
        driver: 'native/stdio-v1',
        resultParser: 'codex-jsonl/v1',
        permissionStrategy: 'codex-cli/v1',
      },
      delivery: { prompt: 'argument', resultSchema: 'file', result: 'stdout' },
    }),
  },
  {
    name: 'a Claude native definition',
    definition: agentDefinition({
      launch: {
        ...agentDefinition().launch,
        args: [{ kind: 'prompt-file' }, { kind: 'result-schema' }],
      },
      protocol: {
        driver: 'native/stdio-v1',
        resultParser: 'claude-stream-json/v1',
        permissionStrategy: 'claude-cli/v1',
      },
      delivery: { prompt: 'file', resultSchema: 'argument', result: 'stdout' },
    }),
  },
])('accepts $name when its delivery and strategy are coherent', ({ definition }) => {
  expect(validateAgentDefinition(definition).definition.protocol.driver).toBe('native/stdio-v1');
});

test.each([
  agentDefinition({
    protocol: { driver: 'acp/v1', resultParser: 'codex-jsonl/v1', permissionStrategy: 'acp/v1' },
  }),
  agentDefinition({ protocol: { driver: 'acp/v1', permissionStrategy: 'codex-cli/v1' } }),
  agentDefinition({ delivery: { prompt: 'stdin', resultSchema: 'protocol', result: 'protocol' } }),
  agentDefinition({
    delivery: { prompt: 'protocol', resultSchema: 'argument', result: 'protocol' },
  }),
  agentDefinition({ delivery: { prompt: 'protocol', resultSchema: 'protocol', result: 'stdout' } }),
  agentDefinition({
    protocol: { driver: 'native/stdio-v1', permissionStrategy: 'codex-cli/v1' },
    delivery: { prompt: 'stdin', resultSchema: 'argument', result: 'stdout' },
  }),
  agentDefinition({
    protocol: {
      driver: 'native/stdio-v1',
      resultParser: 'claude-stream-json/v1',
      permissionStrategy: 'codex-cli/v1',
    },
    delivery: { prompt: 'stdin', resultSchema: 'argument', result: 'stdout' },
  }),
  agentDefinition({
    protocol: {
      driver: 'native/stdio-v1',
      resultParser: 'codex-jsonl/v1',
      permissionStrategy: 'codex-cli/v1',
    },
    delivery: { prompt: 'protocol', resultSchema: 'argument', result: 'stdout' },
  }),
  agentDefinition({
    protocol: {
      driver: 'native/stdio-v1',
      resultParser: 'codex-jsonl/v1',
      permissionStrategy: 'codex-cli/v1',
    },
    delivery: { prompt: 'stdin', resultSchema: 'protocol', result: 'stdout' },
  }),
  agentDefinition({
    protocol: {
      driver: 'native/stdio-v1',
      resultParser: 'codex-jsonl/v1',
      permissionStrategy: 'codex-cli/v1',
    },
    delivery: { prompt: 'stdin', resultSchema: 'argument', result: 'protocol' },
  }),
  agentDefinition({
    launch: { ...agentDefinition().launch, args: [{ kind: 'result-schema' }] },
    protocol: {
      driver: 'native/stdio-v1',
      resultParser: 'codex-jsonl/v1',
      permissionStrategy: 'codex-cli/v1',
    },
    delivery: { prompt: 'argument', resultSchema: 'argument', result: 'stdout' },
  }),
  agentDefinition({
    launch: { ...agentDefinition().launch, args: [{ kind: 'prompt' }] },
    protocol: {
      driver: 'native/stdio-v1',
      resultParser: 'codex-jsonl/v1',
      permissionStrategy: 'codex-cli/v1',
    },
    delivery: { prompt: 'argument', resultSchema: 'file', result: 'stdout' },
  }),
])('rejects an incoherent protocol and delivery combination', (definition) => {
  expect(() => validateAgentDefinition(definition)).toThrow(DefinitionValidationError);
});
