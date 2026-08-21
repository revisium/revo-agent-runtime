import { expect, test, vi } from 'vitest';

import { createNativeProcessExecutionPort } from '../../../../src/application/manager/index.js';
import {
  ExecutionBindingToken,
  InvocationInputSnapshot,
  normalizeInvocationOutcome,
  PreparedLaunch,
  settleProcessStart,
  type LiveOwnedProcess,
  type ProcessIdentity,
  type ProcessInputSink,
  type ProcessStartAttempt,
  type ResultSchemaValidator,
} from '../../../../src/runtime/execution/index.js';

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

test.runIf(process.platform === 'linux')(
  'maps malformed protocol output to a failed completion',
  async () => {
    const execution = createNativeProcessExecutionPort();
    const launch = preparedLaunch({
      preparedPayloads: {
        arguments: [
          '--input-type=module',
          '--eval',
          "process.stdin.resume(); process.stdin.on('end',()=>process.stdout.write('{bad}\\n'))",
        ],
        files: [],
      },
    });

    const running = await execution.start(snapshot('native-parser-failure'), launch);

    await expect(running.completion).resolves.toEqual({ status: 'failed' });
  },
);

test.runIf(process.platform === 'linux')(
  'falls back to process termination when native cancellation is unsupported',
  async () => {
    const execution = createNativeProcessExecutionPort();
    const launch = preparedLaunch({
      preparedPayloads: {
        arguments: [
          '--input-type=module',
          '--eval',
          "setTimeout(() => {}, 5000); console.log(JSON.stringify({type:'turn.completed'}));",
        ],
        files: [],
      },
    });

    const running = await execution.start(snapshot('native-cancellation'), launch);
    await running.requestCancellation();

    await expect(running.completion).resolves.toEqual({ status: 'failed' });
  },
);

const failedIdentityDispatch = () => {
  const killUnactivated = vi.fn(async (): Promise<void> => undefined);
  const dispatch: NonNullable<Parameters<typeof createNativeProcessExecutionPort>[0]> = {
    beginStart: vi.fn((attempt: ProcessStartAttempt) => {
      settleProcessStart(attempt, { status: 'accepted', spawnedAt: 1 });
    }),
    inspectIdentity: vi.fn(async () => ({
      status: 'failed' as const,
      reason: 'inspection_failed' as const,
    })),
    killUnactivated,
    activateIo: vi.fn(),
  };
  return { dispatch, killUnactivated };
};

test('failed identity inspection kills the unactivated accepted process and fails completion', async () => {
  const { dispatch, killUnactivated } = failedIdentityDispatch();
  const execution = createNativeProcessExecutionPort(dispatch);

  const running = await execution.start(snapshot('native-identity-failed'), preparedLaunch());

  await expect(running.completion).resolves.toEqual({ status: 'failed' });
  expect(killUnactivated).toHaveBeenCalledTimes(1);
});

const inertInput: ProcessInputSink = Object.freeze({
  write: async (): Promise<void> => undefined,
  end: async (): Promise<void> => undefined,
  abort: async (): Promise<void> => undefined,
});

const fakeLiveProcess = (terminateAndReap: () => Promise<void>): LiveOwnedProcess =>
  Object.freeze({
    spawnedAt: 1,
    identity: Object.freeze({ pid: 10, processGroupId: 10, fingerprint: 'sha256:test' }),
    completion: Promise.resolve(Object.freeze({ exitCode: 0, signal: null })),
    stdin: inertInput,
    terminateAndReap,
  });

test('failed protocol attach terminates the activated process and fails completion', async () => {
  const terminateAndReap = vi.fn(async (): Promise<void> => undefined);
  const identity: ProcessIdentity = Object.freeze({
    pid: 10,
    processGroupId: 10,
    fingerprint: 'sha256:test',
  });
  const dispatch: NonNullable<Parameters<typeof createNativeProcessExecutionPort>[0]> = {
    beginStart: vi.fn((attempt: ProcessStartAttempt) => {
      settleProcessStart(attempt, { status: 'accepted', spawnedAt: 1 });
    }),
    inspectIdentity: vi.fn(async () => ({ status: 'identified' as const, identity })),
    killUnactivated: vi.fn(),
    activateIo: vi.fn(() => ({
      status: 'activated' as const,
      process: fakeLiveProcess(terminateAndReap),
    })),
  };
  const launch = preparedLaunch({
    binding: {
      ...binding,
      delivery: { prompt: 'stdin', resultSchema: 'argument', result: 'stdout' },
    },
    bindingToken: ExecutionBindingToken.create({
      agentId: 'fixture-agent',
      agentVersion: '1.0.0',
      definitionDigest: 'digest',
      ...binding,
      delivery: { prompt: 'stdin', resultSchema: 'argument', result: 'stdout' },
    }),
  });
  const execution = createNativeProcessExecutionPort(dispatch);

  const running = await execution.start(snapshot('native-attach-failed'), launch);

  await expect(running.completion).resolves.toEqual({ status: 'failed' });
  expect(terminateAndReap).toHaveBeenCalledTimes(1);
});

type NativeDispatchParameter = Parameters<typeof createNativeProcessExecutionPort>[0];

test('rejected spawn completion fails without hanging or cancellation work', async () => {
  const dispatch: NonNullable<NativeDispatchParameter> = {
    beginStart: vi.fn((attempt: ProcessStartAttempt) => {
      settleProcessStart(attempt, { status: 'failed' });
    }),
    inspectIdentity: vi.fn(),
    killUnactivated: vi.fn(),
    activateIo: vi.fn(),
  };
  const execution = createNativeProcessExecutionPort(dispatch);

  const running = await execution.start(snapshot('native-spawn-rejected'), preparedLaunch());

  await expect(running.completion).resolves.toEqual({ status: 'failed' });
  await expect(running.requestCancellation()).resolves.toBeUndefined();
});
