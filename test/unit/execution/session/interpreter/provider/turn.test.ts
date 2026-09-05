import { expect, it, test } from 'vitest';

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
  withSecrets = true,
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
    ...(withSecrets ? { environment: { secrets: ['secret'], values: { token: 'secret' } } } : {}),
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

test('contains asynchronous prompt failure without leaking the provider error', async () => {
  const { resources } = await prepare([]);
  resources.providers.get('provider-1')!.session.prompt = () => ({
    cancel: async () => ({ status: 'requested' }),
    completion: Promise.reject(new Error('private provider detail')),
  });
  const recorded = recordingSessionEffectOutput();
  createProviderTurnInterpreter({ clock, digest, resources }).execute(
    promptEffect,
    recorded.output,
  );
  await flushMicrotasks(16);
  expect(recorded.outcomes.at(-1)).toMatchObject({ type: 'provider.prompt.failed' });
  expect(JSON.stringify(recorded.outcomes)).not.toContain('private provider detail');
});

test('publishes non-message updates without an environment snapshot', async () => {
  const { resources } = await prepare(
    [
      {
        outcome: { status: 'completed' },
        steps: [{ type: 'update', value: { type: 'progress', message: 'Working' } }],
      },
    ],
    false,
  );
  const recorded = recordingSessionEffectOutput();
  createProviderTurnInterpreter({ clock, digest, resources }).execute(
    promptEffect,
    recorded.output,
  );
  await flushMicrotasks(16);
  expect(recorded.updates).toContainEqual(
    expect.objectContaining({ type: 'provider.progress', message: 'Working' }),
  );
});

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
    { ...promptEffect, input: { ...promptEffect.input, metadata: { source: 'test' } } },
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

it('flushes a buffered message fragment before publishing completion', async () => {
  const { resources } = await prepare([
    {
      outcome: { status: 'completed' },
      steps: [{ type: 'update', value: { content: 'sec', type: 'message.delta' } }],
    },
  ]);
  const recorded = recordingSessionEffectOutput();
  createProviderTurnInterpreter({ clock, digest, resources }).execute(
    promptEffect,
    recorded.output,
  );
  await flushMicrotasks(16);
  expect(recorded.updates).toEqual([
    expect.objectContaining({ content: '[REDACTED]', type: 'provider.message_delta' }),
    expect.objectContaining({ type: 'provider.message_completed' }),
  ]);
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

test('ignores unrelated effects and fails when the provider resource is absent', async () => {
  const resources = createSessionInterpreterResources();
  const recorded = recordingSessionEffectOutput();
  const interpreter = createProviderTurnInterpreter({ clock, digest, resources });
  interpreter.execute({ type: 'other' } as never, recorded.output);
  expect(recorded.outcomes).toEqual([]);

  interpreter.execute(promptEffect, recorded.output);
  await flushMicrotasks(4);
  expect(recorded.outcomes.at(-1)).toMatchObject({ type: 'provider.prompt.failed' });
});

test('contains invalid metadata and synchronously throwing prompt creation', async () => {
  const first = await prepare([]);
  const invalid = recordingSessionEffectOutput();
  createProviderTurnInterpreter({ clock, digest, resources: first.resources }).execute(
    { ...promptEffect, input: { ...promptEffect.input, metadata: [] } } as never,
    invalid.output,
  );
  await flushMicrotasks(4);
  expect(invalid.outcomes.at(-1)).toMatchObject({ type: 'provider.prompt.failed' });

  const second = await prepare([]);
  const provider = second.resources.providers.get('provider-1')!;
  provider.session.prompt = () => {
    throw new Error('prompt failed');
  };
  const thrown = recordingSessionEffectOutput();
  createProviderTurnInterpreter({ clock, digest, resources: second.resources }).execute(
    promptEffect,
    thrown.output,
  );
  await flushMicrotasks(4);
  expect(thrown.outcomes.at(-1)).toMatchObject({ type: 'provider.prompt.failed' });
});

test('cancels and rejects a duplicate provider turn resource', async () => {
  const { driver, resources } = await prepare([{ outcome: { status: 'completed' }, steps: [] }]);
  resources.prompts.register('provider-1', 'turn-1', {
    effectId: 'existing',
    prompt: {
      cancel: async () => ({ status: 'requested' }),
      completion: new Promise<never>(() => undefined),
    },
  });
  const recorded = recordingSessionEffectOutput();
  createProviderTurnInterpreter({ clock, digest, resources }).execute(
    promptEffect,
    recorded.output,
  );
  await flushMicrotasks(12);
  expect(driver.calls.some(({ type }) => type === 'prompt.cancel')).toBe(true);
  expect(recorded.outcomes.at(-1)).toMatchObject({ type: 'provider.prompt.failed' });
});

test.each([
  [
    { status: 'completed' as const },
    { outcome: { status: 'completed' }, type: 'provider.prompt.completed' },
  ],
  [
    { status: 'cancelled' as const },
    { outcome: { status: 'cancelled' }, type: 'provider.prompt.completed' },
  ],
  [
    { status: 'interrupted' as const },
    { outcome: { status: 'interrupted' }, type: 'provider.prompt.completed' },
  ],
  [
    {
      failure: { code: 'transport_failed' as const, message: 'failed', retryable: false },
      status: 'failed' as const,
    },
    { type: 'provider.prompt.failed' },
  ],
] as const)('maps terminal provider prompt outcome %#', async (outcome, expected) => {
  const { resources } = await prepare([{ outcome, steps: [] }]);
  const recorded = recordingSessionEffectOutput();
  createProviderTurnInterpreter({ clock, digest, resources }).execute(
    promptEffect,
    recorded.output,
  );
  await flushMicrotasks(16);
  expect(recorded.outcomes.at(-1)).toMatchObject(expected);
});

test('keeps a prompt pending until completion or provider resource release', async () => {
  const { driver, resources } = await prepare([
    { outcome: { status: 'completed' }, steps: [{ barrier: 'never', type: 'wait' }] },
  ]);
  const recorded = recordingSessionEffectOutput();
  createProviderTurnInterpreter({ clock, digest, resources }).execute(
    promptEffect,
    recorded.output,
  );
  await flushMicrotasks(16);
  expect(driver.calls.some(({ type }) => type === 'prompt.cancel')).toBe(false);
  expect(recorded.outcomes.map(({ type }) => type)).toEqual(['provider.prompt.accepted']);
  resources.prompts.takeProvider('provider-1');
  await flushMicrotasks(16);
  expect(recorded.outcomes.at(-1)).toMatchObject({
    type: 'provider.prompt.completed',
    outcome: { status: 'interrupted' },
  });
});

test('publishes tool, plan, and turn-scoped interaction updates', async () => {
  const { resources } = await prepare([
    {
      outcome: { status: 'completed' },
      steps: [
        {
          type: 'update',
          value: {
            kind: 'edit',
            status: 'completed',
            title: 'Edit',
            toolCallId: 'tool-1',
            type: 'tool',
          },
        },
        {
          type: 'update',
          value: {
            items: [{ itemId: 'item-1', status: 'completed', title: 'Done' }],
            type: 'plan',
          },
        },
        {
          type: 'update',
          value: {
            request: {
              action: { kind: 'read' },
              kind: 'permission',
              options: [],
              requestId: 'request-1',
            },
            type: 'interaction.requested',
          },
        },
        { type: 'update', value: { type: 'message.completed' } },
        { type: 'update', value: { type: 'message.completed' } },
      ],
    },
  ]);
  const recorded = recordingSessionEffectOutput();
  createProviderTurnInterpreter({ clock, digest, resources }).execute(
    promptEffect,
    recorded.output,
  );
  await flushMicrotasks(20);
  expect(recorded.updates.map(({ type }) => type)).toEqual([
    'provider.tool',
    'provider.plan',
    'provider.interaction_requested',
    'provider.message_completed',
  ]);
  expect(recorded.updates[2]).toMatchObject({
    scope: { kind: 'turn', turnId: 'turn-1' },
    type: 'provider.interaction_requested',
  });
});
