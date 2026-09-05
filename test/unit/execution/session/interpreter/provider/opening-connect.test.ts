import { expect, test, vi } from 'vitest';

import { validateAgentDefinition } from '../../../../../../src/definition/index.js';
import { SessionOutputCollector } from '../../../../../../src/execution/session/interpreter/output/collect.js';
import { createProviderConnectInterpreter } from '../../../../../../src/execution/session/interpreter/provider/opening/connect.js';
import { createSessionInterpreterResources } from '../../../../../../src/execution/session/interpreter/provider/opening/resources.js';
import { SessionUsageAccumulator } from '../../../../../../src/execution/session/interpreter/provider/usage.js';
import type { SessionEffect } from '../../../../../../src/execution/session/kernel/effect/session-effect.js';
import type { SessionProtocolDriver } from '../../../../../../src/protocol/session/port/driver.js';
import type { SessionProtocolOpening } from '../../../../../../src/protocol/session/port/opening.js';
import type { SessionProtocolSession } from '../../../../../../src/protocol/session/port/session.js';
import { agentDefinition } from '../../../../../support/builders/agent-definition.js';
import { sessionOpeningCommand } from '../../../../../support/session/builders/kernel/opening.js';
import { recordingSessionEffectOutput } from '../../../../../support/session/interpreter/output.js';
import { flushMicrotasks } from '../../../../../support/session/runtime/scheduling/async-steps.js';

const capabilities = {
  cancellation: { prompt: true, session: true },
  interactions: { input: true, permission: true },
  multiTurn: true,
  resume: 'native',
  updates: { message: true, plan: true, progress: true, tool: true, usage: true },
} as const;

const effect = {
  correlation: { effectId: 'provider-effect', epoch: 1, sessionId: 'session_01' },
  preparationId: 'preparation-1',
  processResourceId: 'process-1',
  timeoutMs: 10,
  type: 'provider.open',
} satisfies Extract<SessionEffect, { type: 'provider.open' }>;

const session: SessionProtocolSession = {
  checkpoint: async () => ({
    failure: { code: 'capability_unsupported', message: 'unsupported', retryable: false },
    status: 'unsupported',
  }),
  close: async () => ({ status: 'closed' }),
  prompt: () => ({
    cancel: async () => ({ status: 'requested' }),
    completion: Promise.resolve({ status: 'completed' }),
  }),
  respond: async () => ({ status: 'accepted' }),
};

const setup = (opening: SessionProtocolOpening) => {
  const resources = createSessionInterpreterResources();
  const openingDescriptor = sessionOpeningCommand().opening;
  const definition = validateAgentDefinition(agentDefinition({ version: '1' })).definition;
  resources.preparations.register('preparation-1', {
    correlation: { effectId: 'prepare-effect', epoch: 1, sessionId: 'session_01' },
    opening: openingDescriptor,
    output: new SessionOutputCollector(4_096, []),
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
          state: 'published',
        }),
      },
    },
  });
  resources.processes.register('process-1', {
    completion: new Promise<never>(() => undefined),
    identity: {
      fingerprint: 'process',
      pid: 42,
      processGroupId: 42,
      startedAt: '2026-09-05T00:00:00.500Z',
    },
    terminateAndReap: async () => ({
      exit: { exitCode: 0, signal: null },
      status: 'confirmed',
    }),
    transport: {
      input: new WritableStream<Uint8Array>(),
      output: new ReadableStream<Uint8Array>({ start: (controller) => controller.close() }),
    },
  });
  const driver: SessionProtocolDriver = {
    openFresh: vi.fn(() => opening),
    resume: vi.fn(() => opening),
  };
  const output = recordingSessionEffectOutput();
  const handler = createProviderConnectInterpreter({
    clock: {
      now: () => ({ iso: '2026-09-05T00:00:01.000Z', milliseconds: 1_000 }),
    },
    driver,
    identities: { next: () => 'provider-1' },
    resources,
  });
  return { driver, handler, output, resources };
};

const opening = (
  completion: SessionProtocolOpening['completion'],
  close = vi.fn(async () => ({ status: 'closed' as const })),
): SessionProtocolOpening => ({
  close,
  completion,
  respond: async () => ({ status: 'accepted' }),
});

test('ignores unrelated effects and fails when prepared or process resources are missing', async () => {
  const story = setup(opening(new Promise<never>(() => undefined)));
  story.handler.execute({ type: 'not-provider' } as unknown as SessionEffect, story.output.output);
  expect(story.output.outcomes).toEqual([]);

  story.resources.processes.take('process-1');
  story.handler.execute(effect, story.output.output);
  await flushMicrotasks(4);
  expect(story.output.outcomes).toEqual([
    expect.objectContaining({ type: 'provider.open_failed' }),
  ]);
});

test('contains a synchronously throwing driver', async () => {
  const story = setup(opening(Promise.resolve({ capabilities, session, status: 'opened' })));
  // oxlint-disable-next-line typescript/unbound-method -- Vitest wraps the driver spy without invoking an unbound receiver
  vi.mocked(story.driver.openFresh).mockImplementationOnce(() => {
    throw new Error('driver failed');
  });
  story.handler.execute(effect, story.output.output);
  await flushMicrotasks(4);
  expect(story.output.outcomes.at(-1)).toMatchObject({ type: 'provider.open_failed' });
});

test('closes and fails an opening registry identity collision', async () => {
  const close = vi.fn(async () => ({ status: 'closed' as const }));
  const providerOpening = opening(
    Promise.resolve({ capabilities, session, status: 'opened' }),
    close,
  );
  const story = setup(providerOpening);
  story.resources.providerOpenings.register(
    effect.correlation.effectId,
    'existing-provider',
    providerOpening,
  );

  story.handler.execute(effect, story.output.output);
  await flushMicrotasks(8);
  expect(close).toHaveBeenCalledWith('Provider resource identity collision.');
  expect(story.output.outcomes.at(-1)).toMatchObject({ type: 'provider.open_failed' });
});

test('maps rejected and failed protocol opening settlements and contains close failure', async () => {
  const close = vi.fn(async () => {
    throw new Error('close failed');
  });
  const scenarios = [
    {
      completion: Promise.resolve({
        failure: { code: 'transport_failed' as const, message: 'no', retryable: false },
        status: 'failed' as const,
      }),
      type: 'provider.open_failed',
    },
    { completion: Promise.reject(new Error('opening failed')), type: 'provider.open_timed_out' },
  ] as const;
  for (const scenario of scenarios) {
    const story = setup(opening(scenario.completion, close));
    story.handler.execute(effect, story.output.output);
    // oxlint-disable-next-line no-await-in-loop -- each settlement must drain before the shared close assertion
    await flushMicrotasks(12);
    expect(story.output.outcomes.at(-1)).toMatchObject({ type: scenario.type });
  }
  expect(close).toHaveBeenCalled();
});

test('times out an unsettled opening and reports a timeout after bounded cleanup', async () => {
  const close = vi.fn(async () => ({ status: 'closed' as const }));
  const story = setup(opening(new Promise<never>(() => undefined), close));
  const immediateTimer = {
    schedule: (_milliseconds: number, callback: () => void) => {
      queueMicrotask(callback);
      return { cancel: () => undefined };
    },
  };
  const handler = createProviderConnectInterpreter({
    clock: { now: () => ({ iso: '2026-09-05T00:00:01.000Z', milliseconds: 1_000 }) },
    driver: story.driver,
    identities: { next: () => 'provider-1' },
    resources: story.resources,
    timer: immediateTimer,
  });

  handler.execute(effect, story.output.output);
  await flushMicrotasks(16);
  expect(close).toHaveBeenCalled();
  expect(story.output.outcomes.at(-1)).toMatchObject({ type: 'provider.open_timed_out' });
});

test.each([
  {
    settlement: 'failed',
    type: 'provider.open_failed',
  },
  { settlement: 'rejected', type: 'provider.open_timed_out' },
] as const)('settles a $type outcome after cleanup already took the opening', async (scenario) => {
  const close = vi.fn(async () => ({ status: 'closed' as const }));
  const completion =
    scenario.settlement === 'failed'
      ? Promise.resolve({
          failure: { code: 'transport_failed' as const, message: 'no', retryable: false },
          status: 'failed' as const,
        })
      : Promise.reject(new Error('opening failed'));
  const story = setup(opening(completion, close));

  story.handler.execute(effect, story.output.output);
  expect(
    story.resources.providerOpenings.take(effect.correlation.effectId, 'provider-1'),
  ).toBeDefined();
  await flushMicrotasks(12);

  expect(close).not.toHaveBeenCalled();
  expect(story.output.outcomes.at(-1)).toMatchObject({ type: scenario.type });
});

test('closes an opened session when the provider resource identity is already owned', async () => {
  const close = vi.fn(async () => ({ status: 'closed' as const }));
  const story = setup(
    opening(Promise.resolve({ capabilities, session: { ...session, close }, status: 'opened' })),
  );
  const preparation = story.resources.preparations.get('preparation-1')!;
  story.resources.providers.register('provider-1', {
    capabilities,
    preparation,
    session,
    usage: new SessionUsageAccumulator({ scope: 'session_cumulative' }),
  });

  story.handler.execute(effect, story.output.output);
  await flushMicrotasks(12);
  expect(close).toHaveBeenCalledWith('Provider session could not be registered.');
  expect(story.output.outcomes.at(-1)).toMatchObject({ type: 'provider.open_failed' });
});

test('rejects non-interaction updates during provider opening', async () => {
  let observerUpdate: ((value: never) => Promise<void>) | undefined;
  const driver: SessionProtocolDriver = {
    openFresh: (request) => {
      observerUpdate = (value) => request.observer.update(value);
      return opening(new Promise<never>(() => undefined));
    },
    resume: () => opening(new Promise<never>(() => undefined)),
  };
  const story = setup(opening(new Promise<never>(() => undefined)));
  const handler = createProviderConnectInterpreter({
    clock: { now: () => ({ iso: '2026-09-05T00:00:01.000Z', milliseconds: 1_000 }) },
    driver,
    identities: { next: () => 'provider-1' },
    resources: story.resources,
  });
  handler.execute(effect, story.output.output);
  await flushMicrotasks(4);
  await expect(observerUpdate?.({ type: 'assistant.message.delta' } as never)).rejects.toThrow(
    'Only interactions are valid during provider opening.',
  );
});
