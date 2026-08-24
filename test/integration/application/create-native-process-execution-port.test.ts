import { expect, test } from 'vitest';

import { createNativeProcessExecutionPort } from '../../../src/application/manager/index.js';
import {
  ExecutionBindingToken,
  InvocationInputSnapshot,
  normalizeInvocationOutcome,
  PreparedLaunch,
  type InvocationExecutionPorts,
  type ProcessOutputSink,
  type RedactionChannel,
  type ResultSchemaValidator,
  type RunningExecution,
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

const ignoredOutput = (): ProcessOutputSink =>
  Object.freeze({
    write: async (): Promise<void> => undefined,
    end: async (): Promise<void> => undefined,
  });

const passThroughRedactionChannel = (): RedactionChannel =>
  Object.freeze({
    feed: (chunk: Uint8Array): Uint8Array => new Uint8Array(chunk),
    flush: (): Uint8Array => new Uint8Array(),
    dispose: (): void => undefined,
  });

const preparedResources = (): NonNullable<
  Parameters<InvocationExecutionPorts['execution']['spawnAndIdentify']>[2]
> =>
  Object.freeze({
    attestations: Object.freeze([]),
    frontEnds: Object.freeze({
      stdout: passThroughRedactionChannel(),
      stderr: passThroughRedactionChannel(),
      rawResponse: passThroughRedactionChannel(),
    }),
    evidenceSinks: Object.freeze({ stdout: ignoredOutput(), stderr: ignoredOutput() }),
  });

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

const startExecution = async (
  execution: InvocationExecutionPorts['execution'],
  ...parameters: Parameters<InvocationExecutionPorts['execution']['spawnAndIdentify']>
): Promise<RunningExecution> => {
  const result = await execution.spawnAndIdentify(...parameters);
  if (result.status !== 'identified')
    throw new Error(`Execution did not identify: ${result.reason}`);
  return result.activate();
};

test.runIf(process.platform === 'linux')(
  'drives a short-lived native stdio process to a parsed successful outcome',
  async () => {
    const execution = createNativeProcessExecutionPort();

    const running = await startExecution(
      execution,
      snapshot(),
      preparedLaunch(),
      preparedResources(),
    );
    const observation = await running.completion;

    expect(observation).toMatchObject({
      status: 'completed',
      parsedResponse: { ok: true },
      usage: { inputTokens: 1, outputTokens: 2 },
    });
    expect(normalizeInvocationOutcome(observation, acceptObject)).toMatchObject({
      status: 'succeeded',
      value: { ok: true },
    });
  },
);
