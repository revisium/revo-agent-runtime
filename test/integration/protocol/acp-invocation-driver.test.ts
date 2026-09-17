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
