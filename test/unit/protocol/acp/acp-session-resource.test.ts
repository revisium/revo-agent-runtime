import type * as acp from '@agentclientprotocol/sdk';
import { expect, test, vi } from 'vitest';

import { AcpSessionInteractionBroker } from '../../../../src/protocol/acp/session/interaction/broker.js';
import { AcpSessionResource } from '../../../../src/protocol/acp/session/resource.js';

const capabilities = (resume: 'native' | 'none' = 'native') =>
  ({
    cancellation: { prompt: true, session: true },
    interactions: { input: true, permission: true },
    multiTurn: true as const,
    resume,
    updates: { message: true, plan: true, progress: true, tool: true, usage: true },
  }) as const;

const observer = { update: async () => undefined };

const setup = (
  options: {
    readonly closeSupported?: boolean;
    readonly request?: (method: string) => Promise<unknown>;
    readonly resume?: 'native' | 'none';
  } = {},
) => {
  const observers: unknown[] = [];
  const release = vi.fn();
  const request = vi.fn(options.request ?? (async () => ({ stopReason: 'end_turn' })));
  const notify = vi.fn(async () => undefined);
  const broker = {
    cancelPending: vi.fn(),
    respond: vi.fn(() => ({ status: 'accepted' as const })),
  } as unknown as AcpSessionInteractionBroker;
  const resource = new AcpSessionResource({
    broker,
    capabilities: capabilities(options.resume),
    closeSupported: options.closeSupported ?? true,
    context: { notify, request } as unknown as acp.ClientContext,
    providerSessionId: 'provider-session',
    release,
    setObserver: (nextObserver) => observers.push(nextObserver),
  });
  return { broker, notify, observers, release, request, resource };
};

test('maps completed, cancelled, and invalid-usage prompt outcomes', async () => {
  const responses = [
    { stopReason: 'end_turn', usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 } },
    { stopReason: 'cancelled' },
    { stopReason: 'end_turn', usage: { inputTokens: -1 } },
  ];
  const story = setup({ request: async () => responses.shift() });
  await expect(story.resource.prompt({ observer, prompt: 'one' }).completion).resolves.toEqual({
    status: 'completed',
    usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
  });
  await expect(story.resource.prompt({ observer, prompt: 'two' }).completion).resolves.toEqual({
    status: 'cancelled',
  });
  await expect(
    story.resource.prompt({ observer, prompt: 'three' }).completion,
  ).resolves.toMatchObject({
    failure: { code: 'transport_failed' },
    status: 'failed',
  });
  expect(story.observers).toEqual([observer, undefined, observer, undefined, observer, undefined]);
});

test('contains prompt transport and cancellation failures', async () => {
  const story = setup({ request: async () => Promise.reject(new Error('transport')) });
  story.notify.mockRejectedValueOnce(new Error('cancel failed'));
  const prompt = story.resource.prompt({ observer, prompt: 'work' });

  await expect(prompt.completion).resolves.toMatchObject({
    failure: { code: 'transport_failed' },
    status: 'failed',
  });
  await expect(prompt.cancel()).resolves.toMatchObject({
    failure: { code: 'transport_failed' },
    status: 'failed',
  });
  expect(
    (story.broker as unknown as { cancelPending: ReturnType<typeof vi.fn> }).cancelPending,
  ).toHaveBeenCalled();
});

test('delegates interaction responses and successful prompt cancellation', async () => {
  const story = setup();
  await expect(
    story.resource.respond({
      requestId: 'req',
      response: { kind: 'permission', outcome: 'denied' },
    }),
  ).resolves.toEqual({ status: 'accepted' });
  await expect(
    story.resource.prompt({ observer, prompt: 'work' }).cancel('reason'),
  ).resolves.toEqual({
    status: 'requested',
  });
  expect(story.notify).toHaveBeenCalledOnce();
});

test('captures only provider-native checkpoints', async () => {
  await expect(setup().resource.checkpoint()).resolves.toEqual({
    continuation: { data: { sessionId: 'provider-session' }, format: 'acp/v1' },
    status: 'captured',
  });
  await expect(setup({ resume: 'none' }).resource.checkpoint()).resolves.toMatchObject({
    failure: { code: 'capability_unsupported' },
    status: 'unsupported',
  });
});

test.each([true, false])(
  'closes a session idempotently with closeSupported=%s',
  async (closeSupported) => {
    const story = setup({ closeSupported });
    const first = story.resource.close();
    const second = story.resource.close();

    expect(second).toBe(first);
    await expect(first).resolves.toEqual({ status: 'closed' });
    expect(closeSupported ? story.request : story.notify).toHaveBeenCalledOnce();
    expect(story.release).toHaveBeenCalledOnce();
  },
);

test.each([true, false])(
  'releases ownership when closeSupported=%s close fails',
  async (closeSupported) => {
    const story = setup({
      closeSupported,
      request: async () => Promise.reject(new Error('close failed')),
    });
    if (!closeSupported) story.notify.mockRejectedValueOnce(new Error('close failed'));

    await expect(story.resource.close()).resolves.toMatchObject({
      failure: { code: 'transport_failed' },
      status: 'failed',
    });
    expect(story.release).toHaveBeenCalledOnce();
  },
);
