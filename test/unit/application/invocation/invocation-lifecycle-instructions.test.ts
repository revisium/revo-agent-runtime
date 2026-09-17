import { expect, test } from 'vitest';

import { createSealedAgentRegistry } from '../../../../src/definition/index.js';
import type { PreparedInstructions } from '../../../../src/execution/instructions/prepare.js';
import { createInvocationExecutor } from '../../../../src/execution/invocation/executor.js';
import type { PrivateOutputArtifact } from '../../../../src/execution/output/artifact.js';
import {
  ProcessStartError,
  type ProcessLaunch,
  type ProcessSpawner,
} from '../../../../src/process/index.js';
import type { ProtocolDriver, ProtocolSessionRequest } from '../../../../src/protocol/driver.js';
import { agentDefinition } from '../../../support/builders/agent-definition.js';
import { fixtureLaunchEvidence } from '../../../support/builders/execution-evidence.js';

const definition = createSealedAgentRegistry([
  agentDefinition({ launch: { ...agentDefinition().launch, environment: { CLI: '/cli' } } }),
]).list()[0]!.definition;

const artifact = () => {
  let disposals = 0;
  const value: PrivateOutputArtifact = {
    dispose: async () => {
      disposals += 1;
    },
    path: '/output/revo-opencode-instructions.md',
  };
  return { disposals: () => disposals, value };
};

const instructions = (value: PrivateOutputArtifact): PreparedInstructions => ({
  artifact: value,
  delivery: { channel: 'opencode:config.instructions-file', mode: 'native_append' },
  environment: {
    OPENCODE_CONFIG_CONTENT: '{"instructions":["/output/revo-opencode-instructions.md"]}',
  },
  text: 'Read .revo/index.md.',
});

const request = (prepared: PreparedInstructions) => ({
  definition,
  environment: { PATH: '/bin', CLI: '/caller-cli' },
  idleTimeoutMs: 60_000,
  instructions: prepared,
  launch: fixtureLaunchEvidence,
  onCancelling: () => undefined,
  onStarted: () => undefined,
  parameters: {},
  permissions: {},
  prompt: 'Work.',
  resultSchema: {},
  wallClockTimeoutMs: 60_000,
  workspace: '/fixture',
});

test('the native instructions binding layers over caller and definition environment and the driver never sees the file', async () => {
  const story = artifact();
  const launches: ProcessLaunch[] = [];
  const opened: ProtocolSessionRequest[] = [];
  const processes: ProcessSpawner = {
    start: async (launch) => {
      launches.push(launch);
      return {
        completion: new Promise(() => undefined),
        identity: { fingerprint: 'f', pid: 1, processGroupId: 1, startedAt: 'now' },
        terminateAndReap: async () => ({
          exit: { exitCode: 0, signal: null },
          status: 'confirmed',
        }),
        transport: { input: new WritableStream(), output: new ReadableStream() },
      };
    },
  };
  const protocol: ProtocolDriver = {
    open: async (opening) => {
      opened.push(opening);
      return {
        cancel: async () => undefined,
        close: async () => undefined,
        completion: Promise.resolve({ status: 'completed' as const }),
      };
    },
  };
  const execution = createInvocationExecutor(processes, protocol).start(
    request(instructions(story.value)),
  );
  await execution.admission;
  execution.activate();
  await execution.drainage;

  expect(launches[0]?.environment).toEqual({
    CLI: '/cli',
    OPENCODE_CONFIG_CONTENT: '{"instructions":["/output/revo-opencode-instructions.md"]}',
    PATH: '/bin',
  });
  expect(opened[0]?.instructions).toEqual({
    delivery: { channel: 'opencode:config.instructions-file', mode: 'native_append' },
    text: 'Read .revo/index.md.',
  });
  expect(story.disposals()).toBe(1);
});

test('a spawn failure with confirmed cleanup removes the file; uncertain cleanup leaves it in place', async () => {
  const run = async (cleanup: 'confirmed' | 'uncertain') => {
    const story = artifact();
    const processes: ProcessSpawner = {
      start: async () => {
        throw new ProcessStartError(cleanup);
      },
    };
    const protocol: ProtocolDriver = {
      open: async () => {
        throw new Error('unreachable');
      },
    };
    const execution = createInvocationExecutor(processes, protocol).start(
      request(instructions(story.value)),
    );
    await execution.admission;
    return story.disposals();
  };

  expect(await run('confirmed')).toBe(1);
  expect(await run('uncertain')).toBe(0);
});

test('an unsupported launch strategy disposes a prepared native artifact', async () => {
  const story = artifact();
  const unsupported = createSealedAgentRegistry([
    agentDefinition({
      launch: {
        ...agentDefinition().launch,
        args: [{ kind: 'literal', value: 'bridge.mjs' }, { kind: 'workspace' }],
        environment: { CLI: '/cli' },
      },
    }),
  ]).list()[0]!.definition;
  const processes: ProcessSpawner = {
    start: async () => {
      throw new Error('Unsupported launch must not spawn.');
    },
  };
  const protocol: ProtocolDriver = {
    open: async () => {
      throw new Error('unreachable');
    },
  };
  const execution = createInvocationExecutor(processes, protocol).start({
    ...request(instructions(story.value)),
    definition: unsupported,
  });
  await execution.admission;
  await execution.drainage;

  expect(story.disposals()).toBe(1);
});
