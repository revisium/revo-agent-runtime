import * as acp from '@agentclientprotocol/sdk';
import { expect, test } from 'vitest';

import { validateAgentDefinition } from '../../../src/definition/index.js';
import { createAcpSessionProtocolDriver } from '../../../src/protocol/acp/session/driver.js';
import type { SessionProtocolUpdate } from '../../../src/protocol/session/model/update.js';
import type { SessionProtocolOpeningResult } from '../../../src/protocol/session/port/opening.js';
import type { SessionProtocolObserver } from '../../../src/protocol/session/port/session.js';
import { agentDefinition } from '../../support/builders/agent-definition.js';

const definition = validateAgentDefinition(
  agentDefinition({
    capabilities: {
      cancellation: true,
      session: {
        interactions: { input: true, permission: true },
        multiTurn: true,
        resume: 'native',
        updates: { message: true, plan: true, progress: true, tool: true, usage: true },
      },
      structuredResult: true,
      usage: true,
    },
  }),
).definition;

const protocolCapabilities = {
  sessionCapabilities: { close: {}, resume: {} },
} as const;

const transportPair = () => {
  const clientToAgent = new TransformStream<Uint8Array, Uint8Array>();
  const agentToClient = new TransformStream<Uint8Array, Uint8Array>();
  return {
    agent: acp.ndJsonStream(agentToClient.writable, clientToAgent.readable),
    client: { input: clientToAgent.writable, output: agentToClient.readable },
  };
};

const observer = (updates: SessionProtocolUpdate[]): SessionProtocolObserver => ({
  update: async (value) => {
    updates.push(value);
  },
});

const openedSession = (
  result: SessionProtocolOpeningResult,
): Extract<SessionProtocolOpeningResult, { readonly status: 'opened' }> => {
  expect(result.status).toBe('opened');
  if (result.status !== 'opened') throw new Error('Expected an opened ACP session.');
  return result;
};

test('ACP session driver keeps one provider session across turns and bridges permission', async () => {
  let remembered = '';
  let elicitationOutcome: acp.CreateElicitationResponse | undefined;
  let permissionOutcome: acp.RequestPermissionResponse | undefined;
  const pair = transportPair();
  const agentConnection = acp
    .agent({ name: 'fake-session-agent' })
    .onRequest(acp.methods.agent.initialize, () => ({
      agentCapabilities: protocolCapabilities,
      protocolVersion: acp.PROTOCOL_VERSION,
    }))
    .onRequest(acp.methods.agent.session.new, () => ({ sessionId: 'acp-session-1' }))
    .onRequest(acp.methods.agent.session.prompt, async (context) => {
      const promptBlock = context.params.prompt.find((block) => block.type === 'text');
      const prompt = promptBlock?.type === 'text' ? promptBlock.text : undefined;
      if (remembered.length === 0) {
        remembered = prompt ?? '';
        permissionOutcome = await context.client.request(
          acp.methods.client.session.requestPermission,
          {
            options: [
              { kind: 'allow_once', name: 'Allow once', optionId: 'allow' },
              { kind: 'reject_once', name: 'Reject', optionId: 'reject' },
            ],
            sessionId: context.params.sessionId,
            toolCall: {
              kind: 'edit',
              status: 'pending',
              title: 'Update files',
              toolCallId: 'tool-1',
            },
          },
        );
      } else {
        elicitationOutcome = await context.client.request(acp.methods.client.elicitation.create, {
          message: 'Choose follow-up work.',
          mode: 'form',
          requestedSchema: {
            properties: {
              tasks: {
                items: { enum: ['tests', 'docs'], type: 'string' },
                maxItems: 2,
                type: 'array',
              },
            },
            required: ['tasks'],
            type: 'object',
          },
          sessionId: context.params.sessionId,
        });
      }
      await context.client.notify(acp.methods.client.session.update, {
        sessionId: 'another-session',
        update: {
          content: { text: 'must-not-leak', type: 'text' },
          sessionUpdate: 'agent_message_chunk',
        },
      });
      await context.client.notify(acp.methods.client.session.update, {
        sessionId: context.params.sessionId,
        update: {
          content: { text: remembered, type: 'text' },
          sessionUpdate: 'agent_message_chunk',
        },
      });
      return {
        stopReason: 'end_turn',
        usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
      };
    })
    .onRequest(acp.methods.agent.session.close, () => ({}))
    .connect(pair.agent);
  const updates: SessionProtocolUpdate[] = [];
  const driver = createAcpSessionProtocolDriver();
  const opening = driver.openFresh({
    definition,
    kind: 'fresh',
    observer: observer(updates),
    parameters: {},
    permissions: {},
    transport: pair.client,
    workspace: '/workspace',
  });
  const opened = openedSession(await opening.completion);

  const first = opened.session.prompt({ prompt: 'nonce-7KQ', observer: observer(updates) });
  await expect.poll(() => updates.at(-1)?.type).toBe('interaction.requested');
  const request = updates.at(-1);
  if (request?.type !== 'interaction.requested') throw new Error('Expected permission request.');
  await expect(
    opened.session.respond({
      requestId: request.request.requestId,
      response: { kind: 'permission', optionId: 'allow', outcome: 'selected' },
    }),
  ).resolves.toEqual({ status: 'accepted' });
  await expect(first.completion).resolves.toMatchObject({ status: 'completed' });

  const second = opened.session.prompt({ prompt: 'recall', observer: observer(updates) });
  await expect
    .poll(() => updates.filter(({ type }) => type === 'interaction.requested').length)
    .toBe(2);
  const inputRequest = updates.at(-1);
  if (inputRequest?.type !== 'interaction.requested') throw new Error('Expected input request.');
  expect(inputRequest.request).toMatchObject({
    kind: 'input',
    questions: [
      {
        input: 'select',
        questionId: 'tasks',
        selection: 'multiple',
      },
    ],
  });
  await expect(
    opened.session.respond({
      requestId: inputRequest.request.requestId,
      response: {
        kind: 'input',
        outcome: 'submitted',
        values: { tasks: ['tests', 'docs'] },
      },
    }),
  ).resolves.toEqual({ status: 'accepted' });
  await expect(second.completion).resolves.toMatchObject({
    status: 'completed',
    usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
  });
  expect(permissionOutcome).toEqual({ outcome: { optionId: 'allow', outcome: 'selected' } });
  expect(elicitationOutcome).toEqual({
    action: 'accept',
    content: { tasks: ['tests', 'docs'] },
  });
  expect(updates.filter(({ type }) => type === 'message.delta')).toEqual([
    { content: 'nonce-7KQ', type: 'message.delta' },
    { content: 'nonce-7KQ', type: 'message.delta' },
  ]);
  await expect(opened.session.checkpoint()).resolves.toEqual({
    continuation: { data: { sessionId: 'acp-session-1' }, format: 'acp/v1' },
    status: 'captured',
  });
  await expect(opened.session.close()).resolves.toEqual({ status: 'closed' });
  agentConnection.close();
  await agentConnection.closed;
});

test('ACP session driver resumes only an advertised native session', async () => {
  let resumedSessionId: string | undefined;
  const pair = transportPair();
  const agentConnection = acp
    .agent({ name: 'fake-resume-agent' })
    .onRequest(acp.methods.agent.initialize, () => ({
      agentCapabilities: protocolCapabilities,
      protocolVersion: acp.PROTOCOL_VERSION,
    }))
    .onRequest(acp.methods.agent.session.resume, ({ params }) => {
      resumedSessionId = params.sessionId;
      return {};
    })
    .onRequest(acp.methods.agent.session.prompt, () => ({ stopReason: 'end_turn' }))
    .onRequest(acp.methods.agent.session.close, () => ({}))
    .connect(pair.agent);
  const opening = createAcpSessionProtocolDriver().resume({
    continuation: { data: { sessionId: 'acp-session-1' }, format: 'acp/v1' },
    definition,
    kind: 'resume',
    observer: observer([]),
    parameters: {},
    permissions: {},
    transport: pair.client,
    workspace: '/workspace',
  });
  const opened = openedSession(await opening.completion);

  expect(opened.capabilities.resume).toBe('native');
  expect(resumedSessionId).toBe('acp-session-1');
  await opened.session.close();
  agentConnection.close();
  await agentConnection.closed;
});
