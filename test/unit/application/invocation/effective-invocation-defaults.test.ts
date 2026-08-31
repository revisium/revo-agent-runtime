import { expect, test } from 'vitest';

import type {
  AgentDefinitionInput,
  JsonObject,
} from '../../../../src/contracts/agent-definition.js';
import type { StartAgentInvocation } from '../../../../src/contracts/manager.js';
import { agentDefinition } from '../../../support/builders/agent-definition.js';
import { effectiveInputExecutionStory } from '../../../support/stories/effective-input-execution.js';

const inputSchema = (properties: JsonObject, required: readonly string[] = []): JsonObject => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  additionalProperties: false,
  properties,
  required,
  type: 'object',
});

const definitionWithInputs = (
  overrides: Partial<AgentDefinitionInput> = {},
): AgentDefinitionInput => ({
  ...agentDefinition(),
  parameters: {
    defaults: {
      attempts: 1,
      mode: 'default',
      nested: { preserved: 'default', source: 'definition' },
    },
    schema: inputSchema({
      attempts: { type: 'number' },
      mode: { type: 'string' },
      nested: {
        additionalProperties: false,
        properties: { preserved: { type: 'string' }, source: { type: 'string' } },
        required: ['source'],
        type: 'object',
      },
    }),
  },
  permissions: {
    defaults: { network: true },
    schema: inputSchema({ network: { type: 'boolean' } }),
  },
  ...overrides,
});

const invocation = (
  invocationId: string,
  inputs: Readonly<{
    readonly parameters?: Record<string, unknown>;
    readonly permissions?: Record<string, unknown>;
  }> = {},
): StartAgentInvocation => ({
  agent: { id: 'codex', version: '1.0.0' },
  invocationId,
  output: { directory: '/fixture/output' },
  parameters: inputs.parameters ?? {},
  permissions: inputs.permissions ?? {},
  prompt: 'Return one result.',
  result: { schema: { type: 'object' } },
  workspace: { directory: '/fixture/workspace' },
});
test('sends validated definition defaults to the executor when callers omit both input objects', async () => {
  const subject = effectiveInputExecutionStory([definitionWithInputs()]);
  await subject.manager.initialize([]);

  await (await subject.manager.start(invocation('defaults-only'))).result();
  await subject.manager.shutdown();

  expect(subject.receivedInputs()?.parameters).toEqual({
    attempts: 1,
    mode: 'default',
    nested: { preserved: 'default', source: 'definition' },
  });
  expect(subject.receivedInputs()?.permissions).toEqual({ network: true });
});

test('replaces matching defaults at the top level without recursively merging nested values', async () => {
  const subject = effectiveInputExecutionStory([definitionWithInputs()]);
  await subject.manager.initialize([]);

  await (
    await subject.manager.start(
      invocation('top-level-replacement', {
        parameters: { attempts: 2, nested: { source: 'caller' } },
        permissions: { network: false },
      }),
    )
  ).result();
  await subject.manager.shutdown();

  expect(subject.receivedInputs()?.parameters).toEqual({
    attempts: 2,
    mode: 'default',
    nested: { source: 'caller' },
  });
  expect(subject.receivedInputs()?.permissions).toEqual({ network: false });
});

test('preserves false, zero, empty strings, and null as explicit caller replacements', async () => {
  const definition = definitionWithInputs({
    parameters: {
      defaults: { count: 1, label: 'default', note: 'default' },
      schema: inputSchema({
        count: { type: 'number' },
        label: { type: 'string' },
        note: { type: ['string', 'null'] },
      }),
    },
    permissions: {
      defaults: { network: true },
      schema: inputSchema({ network: { type: 'boolean' } }),
    },
  });
  const subject = effectiveInputExecutionStory([definition]);
  await subject.manager.initialize([]);

  await (
    await subject.manager.start(
      invocation('false-zero-empty-null', {
        parameters: { count: 0, label: '', note: null },
        permissions: { network: false },
      }),
    )
  ).result();
  await subject.manager.shutdown();

  expect(subject.receivedInputs()?.parameters).toEqual({ count: 0, label: '', note: null });
  expect(subject.receivedInputs()?.permissions).toEqual({ network: false });
});

test('rejects missing required effective parameters before execution or output publication', async () => {
  const definition = definitionWithInputs({
    parameters: { schema: inputSchema({ task: { type: 'string' } }, ['task']) },
  });
  const subject = effectiveInputExecutionStory([definition]);
  await subject.manager.initialize([]);

  await expect(subject.manager.start(invocation('missing-parameter'))).rejects.toMatchObject({
    fault: { code: 'revo.agent.parameters_invalid', phase: 'preflight' },
  });
  await subject.manager.shutdown();

  expect(subject.executionStarts()).toBe(0);
  expect(subject.outputPublications()).toBe(0);
});

test('distinguishes a permissions schema failure from a parameters schema failure', async () => {
  const subject = effectiveInputExecutionStory([definitionWithInputs()]);
  await subject.manager.initialize([]);

  await expect(
    subject.manager.start(invocation('wrong-parameter', { parameters: { attempts: 'two' } })),
  ).rejects.toMatchObject({ fault: { code: 'revo.agent.parameters_invalid', phase: 'preflight' } });
  await expect(
    subject.manager.start(invocation('wrong-permission', { permissions: { network: 'yes' } })),
  ).rejects.toMatchObject({
    fault: { code: 'revo.agent.permissions_invalid', phase: 'preflight' },
  });
  await subject.manager.shutdown();

  expect(subject.executionStarts()).toBe(0);
  expect(subject.outputPublications()).toBe(0);
});

test('uses the validator for the exact requested definition version', async () => {
  const older = definitionWithInputs({
    version: '1.0.0',
    parameters: { schema: inputSchema({ answer: { type: 'string' } }, ['answer']) },
  });
  const newer = definitionWithInputs({
    version: '2.0.0',
    parameters: { schema: inputSchema({ answer: { type: 'number' } }, ['answer']) },
  });
  const subject = effectiveInputExecutionStory([older, newer]);
  await subject.manager.initialize([]);

  await expect(
    subject.manager.start({
      ...invocation('old-version', { parameters: { answer: 42 } }),
      agent: { id: 'codex', version: '1.0.0' },
    }),
  ).rejects.toMatchObject({ fault: { code: 'revo.agent.parameters_invalid' } });
  await expect(
    subject.manager.start({
      ...invocation('new-version', { parameters: { answer: 42 } }),
      agent: { id: 'codex', version: '2.0.0' },
    }),
  ).resolves.toMatchObject({ pin: { agentVersion: '2.0.0' } });
  await subject.manager.shutdown();
});
