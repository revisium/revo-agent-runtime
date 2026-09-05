import { expect, it } from 'vitest';

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
