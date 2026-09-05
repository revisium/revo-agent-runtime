import { expect, it } from 'vitest';

import { validateAgentDefinition } from '../../../../../../src/definition/index.js';
import { SessionOutputCollector } from '../../../../../../src/execution/session/interpreter/output/collect.js';
import {
  createSessionInterpreterResources,
  type PreparedSessionResource,
} from '../../../../../../src/execution/session/interpreter/provider/opening/resources.js';
import { createProviderTurnInterpreter } from '../../../../../../src/execution/session/interpreter/provider/turn.js';
import { SessionUsageAccumulator } from '../../../../../../src/execution/session/interpreter/provider/usage.js';
import type { SessionEffectOutput } from '../../../../../../src/execution/session/runtime/effects/outcomes.js';
import { agentDefinition } from '../../../../../support/builders/agent-definition.js';
import { sessionOpeningCommand } from '../../../../../support/session/builders/kernel/opening.js';
import { createControllableSessionProtocolDriver } from '../../../../../support/session/fakes/protocol/driver.js';
import { recordingSessionEffectOutput } from '../../../../../support/session/interpreter/output.js';
import { flushMicrotasks } from '../../../../../support/session/runtime/scheduling/async-steps.js';

const clock = {
  now: () => ({ iso: '2026-09-05T00:00:02.000Z', milliseconds: 2_000 }),
};
const digest = { digest: () => 'message-sha256' };
const capabilities = {
  cancellation: { prompt: true, session: true },
  interactions: { input: true, permission: true },
  multiTurn: true,
  resume: 'native',
  updates: { message: true, plan: true, progress: true, tool: true, usage: true },
} as const;

const prepare = async (
  steps: Parameters<typeof createControllableSessionProtocolDriver>[0]['prompts'],
) => {
  const driver = createControllableSessionProtocolDriver({
    openings: [{ kind: 'fresh', outcome: { capabilities, status: 'opened' }, steps: [] }],
    prompts: steps ?? [],
  });
  const opening = driver.openFresh({
    definition: validateAgentDefinition(agentDefinition({ version: '1' })).definition,
    kind: 'fresh',
    observer: { update: async () => undefined },
    parameters: {},
    permissions: {},
    transport: {
      input: new WritableStream<Uint8Array>(),
      output: new ReadableStream<Uint8Array>({ start: (controller) => controller.close() }),
    },
    workspace: '/workspace',
  });
  const opened = await opening.completion;
  if (opened.status !== 'opened') throw new Error('Expected fake session to open.');
  const resources = createSessionInterpreterResources();
  const openingDescriptor = {
    ...sessionOpeningCommand().opening,
    environment: { secrets: ['secret'], values: { token: 'secret' } },
    usageBaseline: { inputTokens: 10, scope: 'session_cumulative' as const, totalTokens: 10 },
  };
  const preparation: PreparedSessionResource = {
    correlation: { effectId: 'prepare-effect', epoch: 1, sessionId: 'session_01' },
    opening: openingDescriptor,
    output: new SessionOutputCollector(openingDescriptor.limits.maxOutputBytes, ['secret']),
    prepared: {
      definition: validateAgentDefinition(agentDefinition({ version: '1' })).definition,
      inputs: { parameters: {}, permissions: {} },
      launch: { args: [], command: 'agent', cwd: '/workspace' },
      output: {
        publish: async () => ({
          files: {
            directory: '/output',
            manifest: 'session.json',
            stderr: 'stderr.log',
            stdout: 'stdout.log',
          },
          state: 'published' as const,
        }),
      },
    },
  };
  resources.preparations.register('preparation-1', preparation);
  resources.providers.register('provider-1', {
    capabilities,
    preparation,
    session: opened.session,
    usage: new SessionUsageAccumulator(openingDescriptor.usageBaseline),
  });
  return { driver, resources };
};

const promptEffect = {
  correlation: { effectId: 'prompt-effect', epoch: 1, sessionId: 'session_01', turnId: 'turn-1' },
  input: { prompt: 'Do the work', turnId: 'turn-1' },
  providerResourceId: 'provider-1',
  timeoutMs: 100,
  type: 'provider.prompt' as const,
};

it('streams normalized updates in order and restores cumulative usage', async () => {
  const { resources } = await prepare([
    {
      outcome: { status: 'completed', usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } },
      steps: [
        { type: 'update', value: { content: 'hello ', type: 'message.delta' } },
        { type: 'update', value: { content: 'se', type: 'message.delta' } },
        { type: 'update', value: { content: 'cret', type: 'message.delta' } },
        { type: 'update', value: { type: 'message.completed' } },
        { type: 'update', value: { message: 'working', type: 'progress' } },
        { type: 'update', value: { usage: { inputTokens: 2, totalTokens: 2 }, type: 'usage' } },
      ],
    },
  ]);
  const recorded = recordingSessionEffectOutput();
  createProviderTurnInterpreter({ clock, digest, resources }).execute(
    promptEffect,
    recorded.output,
  );
  await flushMicrotasks(24);

  expect(recorded.outcomes.map(({ type }) => type)).toEqual([
    'provider.prompt.accepted',
    'provider.prompt.completed',
  ]);
  expect(recorded.updates.map(({ type }) => type)).toEqual([
    'provider.message_delta',
    'provider.message_delta',
    'provider.message_completed',
    'provider.progress',
    'provider.usage',
    'provider.usage',
  ]);
  expect(recorded.updates.filter(({ type }) => type === 'provider.message_delta')).toEqual([
    expect.objectContaining({ content: 'hello ' }),
    expect.objectContaining({ content: '[REDACTED]' }),
  ]);
  expect(recorded.updates.at(-1)).toMatchObject({
    type: 'provider.usage',
    usage: { inputTokens: 13, outputTokens: 2, scope: 'session_cumulative', totalTokens: 15 },
  });
  expect(recorded.outcomes.at(-1)).toMatchObject({
    outcome: {
      status: 'completed',
      usage: { inputTokens: 13, outputTokens: 2, scope: 'session_cumulative', totalTokens: 15 },
    },
  });
});

it('awaits mailbox backpressure before asking the fake for its next update', async () => {
  const { driver, resources } = await prepare([
    {
      outcome: { status: 'completed' },
      steps: [
        { type: 'update', value: { content: 'first', type: 'message.delta' } },
        { type: 'wait', barrier: 'after-first' },
      ],
    },
  ]);
  const release = Promise.withResolvers<'processed'>();
  const updates: Parameters<SessionEffectOutput['update']>[0][] = [];
  const outcomes: Parameters<SessionEffectOutput['outcome']>[0][] = [];
  const output: SessionEffectOutput = {
    offerUpdate: () => 'accepted',
    outcome: (value) => void outcomes.push(value),
    update: async (value) => {
      updates.push(value);
      return release.promise;
    },
  };
  createProviderTurnInterpreter({ clock, digest, resources }).execute(promptEffect, output);
  await flushMicrotasks(8);

  expect(updates).toHaveLength(1);
  let reached = false;
  void driver.barriers.reached('after-first').then(() => {
    reached = true;
  });
  await flushMicrotasks(4);
  expect(reached).toBe(false);
  release.resolve('processed');
  await driver.barriers.reached('after-first');
  driver.barriers.release('after-first');
  await flushMicrotasks(12);
  expect(outcomes.at(-1)?.type).toBe('provider.prompt.completed');
});
