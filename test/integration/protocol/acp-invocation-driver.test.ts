import * as acp from '@agentclientprotocol/sdk';
import { expect, test } from 'vitest';

import { validateAgentDefinition } from '../../../src/definition/index.js';
import { createAcpProtocolDriver } from '../../../src/protocol/acp/driver.js';
import type { ProtocolSessionRequest } from '../../../src/protocol/driver.js';
import { agentDefinition } from '../../support/builders/agent-definition.js';
import { transportPair } from '../../support/session/fakes/acp/transport.js';

const definition = validateAgentDefinition(agentDefinition()).definition;

const observer: ProtocolSessionRequest['observer'] = {
  activity: () => undefined,
  permission: async () => ({ outcome: 'denied' }),
  resultChunk: () => undefined,
  usage: () => undefined,
};

const request = (
  pair: ReturnType<typeof transportPair>,
  overrides: Partial<ProtocolSessionRequest> = {},
): ProtocolSessionRequest => ({
  definition,
  observer,
  parameters: {},
  permissions: {},
  prompt: 'Return the fake result.',
  resultSchema: { type: 'object' },
  transport: pair.client,
  workspace: '/workspace',
  ...overrides,
});

const fakeAgent = (
  pair: ReturnType<typeof transportPair>,
  options: {
    readonly http?: boolean;
    readonly onNew?: (params: acp.NewSessionRequest) => acp.NewSessionResponse | Promise<never>;
  } = {},
) => {
  const sessionRequests: acp.NewSessionRequest[] = [];
  const cancels: string[] = [];
  const connection = acp
    .agent({ name: 'invocation-fixture' })
    .onRequest(acp.methods.agent.initialize, () => ({
      agentCapabilities: {
        mcpCapabilities: { http: options.http ?? false },
        sessionCapabilities: { close: {} },
      },
      protocolVersion: acp.PROTOCOL_VERSION,
    }))
    .onRequest(acp.methods.agent.session.new, ({ params }) => {
      sessionRequests.push(params);
      return options.onNew?.(params) ?? { sessionId: 'provider-session' };
    })
    .onRequest(acp.methods.agent.session.prompt, () => ({ stopReason: 'end_turn' }))
    .onNotification(acp.methods.agent.session.cancel, ({ params }) => {
      cancels.push(params.sessionId);
    })
    .onRequest(acp.methods.agent.session.close, () => ({}))
    .connect(pair.agent);
  return { cancels, connection, sessionRequests };
};

test('native session metadata is spread onto session/new and the prompt stays unprefixed', async () => {
  const pair = transportPair();
  const agent = fakeAgent(pair);
  const session = await createAcpProtocolDriver().open(
    request(pair, {
      instructions: {
        delivery: { channel: 'acp:session/new._meta.systemPrompt.append', mode: 'native_append' },
        sessionMeta: { systemPrompt: { append: 'Read .revo/index.md.' } },
        text: 'Read .revo/index.md.',
      },
    }),
  );

  await expect(session.completion).resolves.toEqual({ status: 'completed' });
  expect(agent.sessionRequests).toEqual([
    {
      _meta: { systemPrompt: { append: 'Read .revo/index.md.' } },
      cwd: '/workspace',
      mcpServers: [],
    },
  ]);
  await session.cancel();
  expect(agent.cancels).toEqual(['provider-session']);
  await session.close();
  agent.connection.close();
});

test('an HTTP MCP server without the advertised capability fails as invalid parameters before session/new', async () => {
  const pair = transportPair();
  const agent = fakeAgent(pair);
  const session = await createAcpProtocolDriver().open(
    request(pair, {
      mcpServers: [{ name: 'remote', transport: 'http', url: 'https://fixture/mcp' }],
    }),
  );

  await expect(session.completion).resolves.toEqual({
    code: 'revo.agent.parameters_invalid',
    status: 'failed',
  });
  expect(agent.sessionRequests).toEqual([]);
  await session.cancel();
  expect(agent.cancels).toEqual([]);
  await session.close();
  agent.connection.close();
});

test('a rejected session/new fails once with the provider reason and is never retried', async () => {
  const pair = transportPair();
  const agent = fakeAgent(pair, {
    onNew: () => {
      throw acp.RequestError.invalidParams({ error: { message: 'Fixture rejects _meta.' } });
    },
  });
  const session = await createAcpProtocolDriver().open(
    request(pair, {
      instructions: {
        delivery: { channel: 'acp:session/new._meta.systemPrompt.append', mode: 'native_append' },
        sessionMeta: { systemPrompt: { append: 'Read .revo/index.md.' } },
        text: 'Read .revo/index.md.',
      },
    }),
  );

  await expect(session.completion).resolves.toMatchObject({
    diagnostic: { data: { error: { message: 'Fixture rejects _meta.' } } },
    status: 'failed',
  });
  expect(agent.sessionRequests).toHaveLength(1);
  await session.close();
  agent.connection.close();
});

test('a provider result turn isolates tool-phase narration and retains strict final JSON', async () => {
  const pair = transportPair();
  const chunks: string[] = [];
  const prompts: string[] = [];
  const agent = acp
    .agent({ name: 'two-turn-fixture' })
    .onRequest(acp.methods.agent.initialize, () => ({ protocolVersion: acp.PROTOCOL_VERSION }))
    .onRequest(acp.methods.agent.session.new, () => ({ sessionId: 'session' }))
    .onRequest(acp.methods.agent.session.prompt, async ({ params, client }) => {
      prompts.push(JSON.stringify(params.prompt));
      await client.notify(acp.methods.client.session.update, {
        sessionId: 'session',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: {
            type: 'text',
            text:
              prompts.length === 1 ? 'I will call the tool.{"task":true}' : '{"nonce":"result"}',
          },
        },
      });
      return { stopReason: 'end_turn' };
    })
    .onRequest(acp.methods.agent.session.close, () => ({}))
    .connect(pair.agent);
  const session = await createAcpProtocolDriver(() => ({ finalResultTurn: true })).open(
    request(pair, {
      observer: {
        ...observer,
        resultChunk: (bytes) => chunks.push(new TextDecoder().decode(bytes)),
      },
    }),
  );
  await expect(session.completion).resolves.toEqual({ status: 'completed' });
  expect(prompts).toHaveLength(2);
  expect(chunks.join('')).toBe('{"nonce":"result"}');
  expect(prompts[1]).toContain('Do not call tools');
  await session.close();
  agent.close();
});

test.each([true, false])(
  'caller MCP policy approval is fenced to the task session and phase (%s)',
  async (approve) => {
    const pair = transportPair();
    const outcomes: acp.RequestPermissionResponse[] = [];
    const usage: unknown[] = [];
    let prompts = 0;
    const agent = acp
      .agent({ name: 'permission-fixture' })
      .onRequest(acp.methods.agent.initialize, () => ({ protocolVersion: acp.PROTOCOL_VERSION }))
      .onRequest(acp.methods.agent.session.new, () => ({ sessionId: 'session' }))
      .onRequest(acp.methods.agent.session.prompt, async ({ client }) => {
        prompts += 1;
        for (const sessionId of ['foreign', 'session']) {
          outcomes.push(
            // oxlint-disable-next-line no-await-in-loop -- permission fences are exercised in wire order
            await client.request(acp.methods.client.session.requestPermission, {
              sessionId,
              options: [{ kind: 'allow_once', name: 'once', optionId: 'once' }],
              toolCall: { toolCallId: 'echo', title: 'echo' },
            }),
          );
        }
        return {
          stopReason: 'end_turn',
          usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
        };
      })
      .onRequest(acp.methods.agent.session.close, () => ({}))
      .connect(pair.agent);
    const session = await createAcpProtocolDriver(() => ({
      finalResultTurn: true,
      approveMcpPermission: () => (approve ? 'once' : undefined),
    })).open(
      request(pair, {
        definition: { ...definition, capabilities: { ...definition.capabilities, usage: true } },
        observer: { ...observer, usage: (value) => usage.push(value) },
      }),
    );
    await expect(session.completion).resolves.toEqual({ status: 'completed' });
    expect(prompts).toBe(2);
    expect(outcomes).toEqual([
      { outcome: { outcome: 'cancelled' } },
      { outcome: approve ? { outcome: 'selected', optionId: 'once' } : { outcome: 'cancelled' } },
      { outcome: { outcome: 'cancelled' } },
      { outcome: { outcome: 'cancelled' } },
    ]);
    expect(usage).toEqual([{ inputTokens: 4, outputTokens: 6, totalTokens: 10 }]);
    await session.close();
    agent.close();
  },
);

test.each(['end_turn', 'cancelled'] as const)(
  'cancellation never starts a result turn after task stop %s',
  async (stopReason) => {
    const pair = transportPair();
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let prompts = 0;
    const agent = acp
      .agent({ name: 'cancel-result-fixture' })
      .onRequest(acp.methods.agent.initialize, () => ({ protocolVersion: acp.PROTOCOL_VERSION }))
      .onRequest(acp.methods.agent.session.new, () => ({ sessionId: 'session' }))
      .onRequest(acp.methods.agent.session.prompt, async () => {
        prompts += 1;
        started.resolve();
        await release.promise;
        return { stopReason };
      })
      .onNotification(acp.methods.agent.session.cancel, () => {
        release.resolve();
      })
      .onRequest(acp.methods.agent.session.close, () => ({}))
      .connect(pair.agent);
    const session = await createAcpProtocolDriver(() => ({ finalResultTurn: true })).open(
      request(pair),
    );
    await started.promise;
    await session.cancel();
    await expect(session.completion).resolves.toEqual({ status: 'completed' });
    expect(prompts).toBe(1);
    await session.close();
    agent.close();
  },
);

test('cancellation during session creation prevents the task prompt', async () => {
  const pair = transportPair();
  const creating = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let prompts = 0;
  const agent = acp
    .agent({ name: 'cancel-opening-fixture' })
    .onRequest(acp.methods.agent.initialize, () => ({ protocolVersion: acp.PROTOCOL_VERSION }))
    .onRequest(acp.methods.agent.session.new, async () => {
      creating.resolve();
      await release.promise;
      return { sessionId: 'session' };
    })
    .onRequest(acp.methods.agent.session.prompt, () => {
      prompts += 1;
      return { stopReason: 'end_turn' };
    })
    .onRequest(acp.methods.agent.session.close, () => ({}))
    .connect(pair.agent);
  const session = await createAcpProtocolDriver(() => ({ finalResultTurn: true })).open(
    request(pair),
  );
  await creating.promise;
  await session.cancel();
  release.resolve();
  await expect(session.completion).resolves.toEqual({ status: 'completed' });
  expect(prompts).toBe(0);
  await session.close();
  agent.close();
});
