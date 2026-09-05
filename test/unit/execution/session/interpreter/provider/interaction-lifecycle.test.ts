import { expect, it, test, vi } from 'vitest';

import { validateAgentDefinition } from '../../../../../../src/definition/index.js';
import { SessionOutputCollector } from '../../../../../../src/execution/session/interpreter/output/collect.js';
import { createProviderInteractionInterpreter } from '../../../../../../src/execution/session/interpreter/provider/interaction.js';
import { createProviderLifecycleInterpreters } from '../../../../../../src/execution/session/interpreter/provider/lifecycle.js';
import {
  createSessionInterpreterResources,
  type PreparedSessionResource,
} from '../../../../../../src/execution/session/interpreter/provider/opening/resources.js';
import { SessionUsageAccumulator } from '../../../../../../src/execution/session/interpreter/provider/usage.js';
import { agentDefinition } from '../../../../../support/builders/agent-definition.js';
import { sessionOpeningCommand } from '../../../../../support/session/builders/kernel/opening.js';
import { createControllableSessionProtocolDriver } from '../../../../../support/session/fakes/protocol/driver.js';
import { recordingSessionEffectOutput } from '../../../../../support/session/interpreter/output.js';
import { flushMicrotasks } from '../../../../../support/session/runtime/scheduling/async-steps.js';

const clock = { now: () => ({ iso: '2026-09-05T00:00:03.000Z', milliseconds: 3_000 }) };
const capabilities = {
  cancellation: { prompt: true, session: true },
  interactions: { input: true, permission: true },
  multiTurn: true,
  resume: 'native',
  updates: { message: true, plan: true, progress: true, tool: true, usage: true },
} as const;

const setup = async (options: {
  readonly interactions?: Parameters<
    typeof createControllableSessionProtocolDriver
  >[0]['interactions'];
  readonly cancellations?: Parameters<
    typeof createControllableSessionProtocolDriver
  >[0]['cancellations'];
  readonly closes?: Parameters<typeof createControllableSessionProtocolDriver>[0]['closes'];
}) => {
  const driver = createControllableSessionProtocolDriver({
    cancellations: options.cancellations ?? [],
    closes: options.closes ?? [],
    interactions: options.interactions ?? [],
    openings: [{ kind: 'fresh', outcome: { capabilities, status: 'opened' }, steps: [] }],
  });
  const definition = validateAgentDefinition(agentDefinition({ version: '1' })).definition;
  const opening = driver.openFresh({
    definition,
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
  if (opened.status !== 'opened') throw new Error('Expected an opened fake provider.');
  const resources = createSessionInterpreterResources();
  const descriptor = sessionOpeningCommand().opening;
  const preparation: PreparedSessionResource = {
    correlation: { effectId: 'prepare', epoch: 1, sessionId: 'session_01' },
    opening: descriptor,
    output: new SessionOutputCollector(descriptor.limits.maxOutputBytes, []),
    prepared: {
      definition,
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
  resources.providers.register('provider-1', {
    capabilities,
    preparation,
    session: opened.session,
    usage: new SessionUsageAccumulator(descriptor.usageBaseline),
  });
  return { driver, resources };
};

it('delivers a reserved interaction response through the hot provider', async () => {
  const { driver, resources } = await setup({ interactions: [{ status: 'accepted' }] });
  const recorded = recordingSessionEffectOutput();
  createProviderInteractionInterpreter({ clock, resources }).execute(
    {
      correlation: { effectId: 'respond', epoch: 1, sessionId: 'session_01' },
      providerResourceId: 'provider-1',
      request: {
        action: { kind: 'edit', title: 'Edit' },
        kind: 'permission',
        options: [{ kind: 'allow_once', label: 'Allow', optionId: 'allow' }],
        requestId: 'permission-1',
      },
      response: { kind: 'permission', optionId: 'allow', outcome: 'selected' },
      scope: { kind: 'opening' },
      timeoutMs: 100,
      type: 'provider.interaction.respond',
    },
    recorded.output,
  );
  await flushMicrotasks(8);
  expect(driver.calls.at(-1)).toMatchObject({
    request: { requestId: 'permission-1', response: { optionId: 'allow' } },
    type: 'interaction.respond',
  });
  expect(recorded.outcomes.at(-1)?.type).toBe('provider.interaction.accepted');
});

it('maps failed interaction delivery to a stable provider fault', async () => {
  const failure = { code: 'transport_failed' as const, message: 'raw failure', retryable: true };
  const { resources } = await setup({ interactions: [{ failure, status: 'failed' }] });
  const recorded = recordingSessionEffectOutput();
  createProviderInteractionInterpreter({ clock, resources }).execute(
    {
      correlation: { effectId: 'respond', epoch: 1, sessionId: 'session_01' },
      providerResourceId: 'provider-1',
      request: { action: { kind: 'read' }, kind: 'permission', options: [], requestId: 'p' },
      response: { kind: 'permission', outcome: 'denied' },
      scope: { kind: 'opening' },
      timeoutMs: 100,
      type: 'provider.interaction.respond',
    },
    recorded.output,
  );
  await flushMicrotasks(8);
  expect(recorded.outcomes.at(-1)).toMatchObject({
    fault: { code: 'revo.agent.protocol_failed' },
    type: 'provider.interaction.failed',
  });
});

it('cancels a registered prompt, publishes cancellation, and closes the provider', async () => {
  const { driver, resources } = await setup({
    cancellations: [{ status: 'requested' }],
    closes: [{ status: 'closed' }],
  });
  const prompt = {
    cancel: (reason?: string) => driver.cancelPrompt(reason),
    completion: new Promise<never>(() => undefined),
  };
  resources.prompts.register('provider-1', 'turn-1', { effectId: 'prompt', prompt });
  const recorded = recordingSessionEffectOutput();
  const [cancel, close] = createProviderLifecycleInterpreters({ clock, resources });
  cancel?.execute(
    {
      correlation: { effectId: 'cancel', epoch: 1, sessionId: 'session_01', turnId: 'turn-1' },
      providerResourceId: 'provider-1',
      timeoutMs: 100,
      turnId: 'turn-1',
      type: 'provider.turn.cancel',
    },
    recorded.output,
  );
  close?.execute(
    {
      correlation: { effectId: 'close', epoch: 1, sessionId: 'session_01' },
      providerResourceId: 'provider-1',
      timeoutMs: 100,
      type: 'provider.close',
    },
    recorded.output,
  );
  await flushMicrotasks(12);
  expect(driver.calls.slice(-2).map(({ type }) => type)).toEqual([
    'prompt.cancel',
    'session.close',
  ]);
  expect(recorded.outcomes).toEqual([
    expect.objectContaining({
      outcome: { status: 'cancelled' },
      type: 'provider.prompt.completed',
    }),
  ]);
  expect(resources.providers.get('provider-1')).toBeUndefined();
});

const cancelEffect = {
  correlation: { effectId: 'cancel', epoch: 1, sessionId: 'session_01', turnId: 'turn-1' },
  providerResourceId: 'provider-1',
  reason: 'stop',
  timeoutMs: 100,
  turnId: 'turn-1',
  type: 'provider.turn.cancel' as const,
};

test('lifecycle handlers ignore effects outside their discriminant', async () => {
  const resources = createSessionInterpreterResources();
  const recorded = recordingSessionEffectOutput();
  const [cancel, close] = createProviderLifecycleInterpreters({ clock, resources });
  cancel?.execute({ type: 'other' } as never, recorded.output);
  close?.execute({ type: 'other' } as never, recorded.output);
  await flushMicrotasks(2);
  expect(recorded.outcomes).toEqual([]);
});

test('fails cancellation when no active prompt owns the requested turn', async () => {
  const resources = createSessionInterpreterResources();
  const recorded = recordingSessionEffectOutput();
  const [cancel] = createProviderLifecycleInterpreters({ clock, resources });
  cancel?.execute(cancelEffect, recorded.output);
  await flushMicrotasks(4);
  expect(recorded.outcomes.at(-1)).toMatchObject({ type: 'provider.prompt.failed' });
});

test.each([
  [{ status: 'unsupported' as const }, 'provider.prompt.failed'],
  [
    {
      failure: { code: 'transport_failed' as const, message: 'failed', retryable: false },
      status: 'failed' as const,
    },
    'provider.prompt.failed',
  ],
] as const)('maps non-requested cancellation outcome %#', async (outcome, type) => {
  const { driver, resources } = await setup({ cancellations: [outcome] });
  const prompt = {
    cancel: (reason?: string) => driver.cancelPrompt(reason),
    completion: new Promise<never>(() => undefined),
  };
  resources.prompts.register('provider-1', 'turn-1', { effectId: 'prompt', prompt });
  const recorded = recordingSessionEffectOutput();
  const [cancel] = createProviderLifecycleInterpreters({ clock, resources });
  cancel?.execute(cancelEffect, recorded.output);
  await flushMicrotasks(12);
  expect(recorded.outcomes.at(-1)).toMatchObject({ type });
});

test('contains a thrown prompt cancellation and maps it to protocol failure', async () => {
  const resources = createSessionInterpreterResources();
  resources.prompts.register('provider-1', 'turn-1', {
    effectId: 'prompt',
    prompt: {
      cancel: () => {
        throw new Error('cancel failed');
      },
      completion: new Promise<never>(() => undefined),
    },
  });
  const recorded = recordingSessionEffectOutput();
  const [cancel] = createProviderLifecycleInterpreters({ clock, resources });
  cancel?.execute(cancelEffect, recorded.output);
  await flushMicrotasks(8);
  expect(recorded.outcomes.at(-1)).toMatchObject({ type: 'provider.prompt.failed' });
});

test('times out prompt cancellation when the provider never settles', async () => {
  const resources = createSessionInterpreterResources();
  resources.prompts.register('provider-1', 'turn-1', {
    effectId: 'prompt',
    prompt: {
      cancel: async () => new Promise<never>(() => undefined),
      completion: new Promise<never>(() => undefined),
    },
  });
  const timer = {
    schedule: (_milliseconds: number, callback: () => void) => {
      queueMicrotask(callback);
      return { cancel: () => undefined };
    },
  };
  const recorded = recordingSessionEffectOutput();
  const [cancel] = createProviderLifecycleInterpreters({ clock, resources, timer });
  cancel?.execute(cancelEffect, recorded.output);
  await flushMicrotasks(16);
  expect(recorded.outcomes.at(-1)).toMatchObject({ type: 'provider.prompt.timed_out' });
});

test('close skips already-cancelling prompts, contains cancellation failure, and forwards reason', async () => {
  const { driver, resources } = await setup({ closes: [{ status: 'closed' }] });
  const failedCancel = vi.fn(async () => {
    throw new Error('cancel failed');
  });
  const skippedCancel = vi.fn(async () => ({ status: 'requested' as const }));
  resources.prompts.register('provider-1', 'turn-active', {
    effectId: 'active',
    prompt: { cancel: failedCancel, completion: new Promise<never>(() => undefined) },
  });
  resources.prompts.register('provider-1', 'turn-cancelling', {
    effectId: 'cancelling',
    prompt: { cancel: skippedCancel, completion: new Promise<never>(() => undefined) },
  });
  resources.prompts.markCancelling('provider-1', 'turn-cancelling');
  const [, close] = createProviderLifecycleInterpreters({ clock, resources });
  close?.execute(
    {
      correlation: { effectId: 'close', epoch: 1, sessionId: 'session_01' },
      providerResourceId: 'provider-1',
      reason: 'shutdown',
      timeoutMs: 100,
      type: 'provider.close',
    },
    recordingSessionEffectOutput().output,
  );
  await flushMicrotasks(12);
  expect(failedCancel).toHaveBeenCalledWith('shutdown');
  expect(skippedCancel).not.toHaveBeenCalled();
  expect(driver.calls.at(-1)).toMatchObject({ reason: 'shutdown', type: 'session.close' });
});

test('close handles missing and still-opening provider endpoints', async () => {
  const resources = createSessionInterpreterResources();
  const closeEndpoint = vi.fn(async () => ({ status: 'closed' as const }));
  const [, close] = createProviderLifecycleInterpreters({ clock, resources });
  const closeEffect = {
    correlation: { effectId: 'close', epoch: 1, sessionId: 'session_01' },
    providerResourceId: 'provider-1',
    timeoutMs: 100,
    type: 'provider.close' as const,
  };
  close?.execute(closeEffect, recordingSessionEffectOutput().output);
  await flushMicrotasks(2);

  resources.providerOpenings.register('opening-effect', 'provider-1', {
    close: closeEndpoint,
    completion: new Promise<never>(() => undefined),
    respond: async () => ({ status: 'accepted' }),
  });
  close?.execute(closeEffect, recordingSessionEffectOutput().output);
  await flushMicrotasks(8);
  expect(closeEndpoint).toHaveBeenCalledOnce();
  expect(resources.providerOpenings.get('provider-1')).toBeUndefined();
});

test('close contains an endpoint that remains unsettled across both timeout windows', async () => {
  const resources = createSessionInterpreterResources();
  resources.providerOpenings.register('opening-effect', 'provider-1', {
    close: async () => new Promise<never>(() => undefined),
    completion: new Promise<never>(() => undefined),
    respond: async () => ({ status: 'accepted' }),
  });
  const timer = {
    schedule: (_milliseconds: number, callback: () => void) => {
      queueMicrotask(callback);
      return { cancel: () => undefined };
    },
  };
  const [, close] = createProviderLifecycleInterpreters({ clock, resources, timer });
  close?.execute(
    {
      correlation: { effectId: 'close', epoch: 1, sessionId: 'session_01' },
      providerResourceId: 'provider-1',
      timeoutMs: 100,
      type: 'provider.close',
    },
    recordingSessionEffectOutput().output,
  );
  await flushMicrotasks(12);
  expect(resources.providerOpenings.get('provider-1')).toBeUndefined();
});

const interactionEffect = {
  correlation: { effectId: 'respond', epoch: 1, sessionId: 'session_01' },
  providerResourceId: 'provider-1',
  request: {
    action: { kind: 'read' as const },
    kind: 'permission' as const,
    options: [],
    requestId: 'p',
  },
  response: { kind: 'permission' as const, outcome: 'denied' as const },
  scope: { kind: 'opening' as const },
  timeoutMs: 100,
  type: 'provider.interaction.respond' as const,
};

test('interaction handler ignores unrelated effects and fails without an endpoint', async () => {
  const resources = createSessionInterpreterResources();
  const recorded = recordingSessionEffectOutput();
  const handler = createProviderInteractionInterpreter({ clock, resources });
  handler.execute({ type: 'other' } as never, recorded.output);
  handler.execute(interactionEffect, recorded.output);
  await flushMicrotasks(6);
  expect(recorded.outcomes).toEqual([
    expect.objectContaining({ type: 'provider.interaction.failed' }),
  ]);
});

test.each([
  [
    {
      failure: { code: 'configuration_stale' as const, message: 'stale', retryable: false },
      status: 'rejected' as const,
    },
    'provider.interaction.rejected',
    'revo.agent.configuration_stale',
  ],
  [
    {
      failure: {
        code: 'configuration_value_unsupported' as const,
        message: 'bad',
        retryable: true,
      },
      status: 'failed' as const,
    },
    'provider.interaction.failed',
    'revo.agent.configuration_value_unsupported',
  ],
  [
    {
      failure: { code: 'capability_unsupported' as const, message: 'no', retryable: false },
      status: 'failed' as const,
    },
    'provider.interaction.failed',
    'revo.agent.session_unsupported',
  ],
] as const)('maps interaction protocol outcome %#', async (outcome, type, code) => {
  const { resources } = await setup({ interactions: [outcome] });
  const recorded = recordingSessionEffectOutput();
  createProviderInteractionInterpreter({ clock, resources }).execute(
    {
      ...interactionEffect,
      correlation: { ...interactionEffect.correlation, turnId: 'turn-1' },
      scope: { kind: 'turn', turnId: 'turn-1' },
    },
    recorded.output,
  );
  await flushMicrotasks(10);
  expect(recorded.outcomes.at(-1)).toMatchObject({
    fault: { code, phase: 'session_running' },
    type,
  });
});

test('delivers through an opening endpoint and contains a thrown response', async () => {
  const resources = createSessionInterpreterResources();
  const respond = vi.fn(async () => ({ status: 'accepted' as const }));
  resources.providerOpenings.register('open-effect', 'provider-1', {
    close: async () => ({ status: 'closed' }),
    completion: new Promise<never>(() => undefined),
    respond,
  });
  const accepted = recordingSessionEffectOutput();
  createProviderInteractionInterpreter({ clock, resources }).execute(
    interactionEffect,
    accepted.output,
  );
  await flushMicrotasks(8);
  expect(respond).toHaveBeenCalledOnce();
  expect(accepted.outcomes.at(-1)).toMatchObject({ type: 'provider.interaction.accepted' });

  const throwingResources = createSessionInterpreterResources();
  throwingResources.providerOpenings.register('open-effect', 'provider-1', {
    close: async () => ({ status: 'closed' }),
    completion: new Promise<never>(() => undefined),
    respond: () => {
      throw new Error('respond failed');
    },
  });
  const failed = recordingSessionEffectOutput();
  createProviderInteractionInterpreter({ clock, resources: throwingResources }).execute(
    interactionEffect,
    failed.output,
  );
  await flushMicrotasks(8);
  expect(failed.outcomes.at(-1)).toMatchObject({ type: 'provider.interaction.failed' });
});

test('times out an unsettled interaction response', async () => {
  const resources = createSessionInterpreterResources();
  resources.providerOpenings.register('open-effect', 'provider-1', {
    close: async () => ({ status: 'closed' }),
    completion: new Promise<never>(() => undefined),
    respond: async () => new Promise<never>(() => undefined),
  });
  const timer = {
    schedule: (_milliseconds: number, callback: () => void) => {
      queueMicrotask(callback);
      return { cancel: () => undefined };
    },
  };
  const recorded = recordingSessionEffectOutput();
  createProviderInteractionInterpreter({ clock, resources, timer }).execute(
    interactionEffect,
    recorded.output,
  );
  await flushMicrotasks(16);
  expect(recorded.outcomes.at(-1)).toMatchObject({ type: 'provider.interaction.timed_out' });
});
