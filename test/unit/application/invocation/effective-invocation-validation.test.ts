import { expect, test } from 'vitest';

import { EffectiveInvocationInputPolicy } from '../../../../src/application/admission/effective-inputs.js';
import type {
  AgentDefinitionInput,
  JsonObject,
} from '../../../../src/contracts/agent-definition.js';
import type { StartAgentInvocation } from '../../../../src/contracts/manager.js';
import { validateAgentDefinition } from '../../../../src/definition/index.js';
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
test('owns frozen effective values before the caller can mutate their request', async () => {
  const subject = effectiveInputExecutionStory([definitionWithInputs()]);
  const callerParameters = { nested: { source: 'caller' } };
  const callerPermissions = { network: false };
  await subject.manager.initialize([]);

  const handle = await subject.manager.start(
    invocation('input-mutation', { parameters: callerParameters, permissions: callerPermissions }),
  );
  callerParameters.nested.source = 'mutated';
  callerPermissions.network = true;
  await handle.result();
  await subject.manager.shutdown();

  const received = subject.receivedInputs();
  expect(received?.parameters).toEqual({
    attempts: 1,
    mode: 'default',
    nested: { source: 'caller' },
  });
  expect(received?.permissions).toEqual({ network: false });
  expect(Object.isFrozen(received?.parameters)).toBe(true);
  expect(Object.isFrozen(received?.parameters.nested)).toBe(true);
  expect(Object.isFrozen(received?.permissions)).toBe(true);
});

test('keeps hostile input names as own data properties on package-owned null-prototype objects', () => {
  const stringValues = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    additionalProperties: { type: 'string' },
    type: 'object',
  } satisfies JsonObject;
  const definition = validateAgentDefinition(
    definitionWithInputs({
      parameters: {
        defaults: Object.fromEntries([
          ['__proto__', 'definition-prototype'],
          ['constructor', 'definition-constructor'],
          ['prototype', 'definition-value'],
        ]),
        schema: stringValues,
      },
      permissions: {
        defaults: Object.fromEntries([['__proto__', 'definition-permission']]),
        schema: stringValues,
      },
    }),
  );
  const prepared = EffectiveInvocationInputPolicy.create([definition]).prepare(definition, {
    parameters: Object.fromEntries([['__proto__', 'caller-prototype']]),
    permissions: {},
  });
  if (prepared.status !== 'prepared') throw new Error('Expected valid hostile property names.');

  expect(Object.getPrototypeOf(prepared.inputs.parameters)).toBeNull();
  expect(prepared.inputs.parameters).toEqual(
    Object.fromEntries([
      ['__proto__', 'caller-prototype'],
      ['constructor', 'definition-constructor'],
      ['prototype', 'definition-value'],
    ]),
  );
  expect(Object.hasOwn(prepared.inputs.parameters, '__proto__')).toBe(true);
  expect(Object.getPrototypeOf(prepared.inputs.permissions)).toBeNull();
  expect(prepared.inputs.permissions).toEqual(
    Object.fromEntries([['__proto__', 'definition-permission']]),
  );
  expect(Object.hasOwn(prepared.inputs.permissions, '__proto__')).toBe(true);
});
