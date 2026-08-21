import { expect, test } from 'vitest';

import { createNativeProcessExecutionPort } from '../../../src/application/manager/index.js';
import {
  ExecutionBindingToken,
  InvocationInputSnapshot,
  normalizeInvocationOutcome,
  PreparedLaunch,
  type ResultSchemaValidator,
} from '../../../src/runtime/execution/index.js';

const resultSchema = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
});

const acceptObject: ResultSchemaValidator = Object.freeze({ validate: () => undefined });

const snapshot = (invocationId = 'native-execution-unit'): InvocationInputSnapshot => {
  const value = InvocationInputSnapshot.create({
    invocationId,
    agent: { id: 'fixture-agent', version: '1.0.0' },
    prompt: 'Return JSON.',
    workspace: { directory: process.cwd() },
    parameters: {},
    permissions: {},
    result: { schema: resultSchema },
    output: { directory: '/outputs/invocation' },
  });
  if (value === undefined) throw new Error('Expected snapshot.');
  return value;
};

const binding = Object.freeze({
  protocolDriverId: 'native/stdio-v1' as const,
  resultParserId: 'codex-jsonl/v1' as const,
  permissionStrategyId: 'codex-cli/v1' as const,
  delivery: Object.freeze({
    prompt: 'argument' as const,
    resultSchema: 'argument' as const,
    result: 'stdout' as const,
  }),
});

const preparedLaunch = (
  overrides: Partial<Parameters<typeof PreparedLaunch.create>[0]> = {},
): PreparedLaunch => {
  const pin = { agentId: 'fixture-agent', agentVersion: '1.0.0', definitionDigest: 'digest' };
  const value = PreparedLaunch.create({
    pin,
    executable: process.execPath,
    reportedVersion: '1.0.0',
    limits: snapshot().limits,
    effectiveParameters: {},
    effectivePermissions: {},
    childEnvironment: {},
    childEnvironmentSecretValues: [],
    secretValues: [],
    resultSchemaValidator: acceptObject,
    outputResourcePlan: {
      invocationId: 'native-execution-unit',
      outputDirectory: '/outputs/invocation',
      needsPromptFile: false,
      needsResultSchemaFile: false,
    },
    interpretedArgumentTemplate: [
      { kind: 'arguments', arguments: ['--input-type=module', '--eval'] },
    ],
    preparedPayloads: {
      arguments: [
        '--input-type=module',
        '--eval',
        "process.stdin.resume(); process.stdin.on('end',()=>{console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'{\\\"ok\\\":true}'}})); console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:1,output_tokens:2}}));});",
      ],
      files: [],
    },
    binding,
    bindingToken: ExecutionBindingToken.create({ ...pin, ...binding }),
    ...overrides,
  });
  if (value === undefined) throw new Error('Expected prepared launch.');
  return value;
};

test.runIf(process.platform === 'linux')(
  'drives a short-lived native stdio process to a parsed successful outcome',
  async () => {
    const execution = createNativeProcessExecutionPort();

    const running = await execution.start(snapshot(), preparedLaunch());
    const observation = await running.completion;

    expect(observation).toMatchObject({
      status: 'completed',
      parsedResponse: { ok: true },
      usage: { inputTokens: 1, outputTokens: 2 },
    });
    expect(normalizeInvocationOutcome(observation, acceptObject)).toEqual({
      status: 'succeeded',
      value: { ok: true },
    });
  },
);
