import * as acp from '@agentclientprotocol/sdk';
import { expect, test } from 'vitest';

import { validateAgentDefinition } from '../../../src/definition/index.js';
import { createAcpSessionProtocolDriver } from '../../../src/protocol/acp/session/driver.js';
import type { SessionProtocolUpdate } from '../../../src/protocol/session/model/update.js';
import type { SessionProtocolOpeningResult } from '../../../src/protocol/session/port/opening.js';
import type { SessionProtocolObserver } from '../../../src/protocol/session/port/session.js';
import { agentDefinition } from '../../support/builders/agent-definition.js';
import { transportPair } from '../../support/session/fakes/acp/transport.js';

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

test.each([false, true])(
  'prompt completion waits for preceding ACP updates (coalesced: %s)',
  async (coalescedUpdates) => {
    const pair = transportPair({ coalescedUpdates });
    const delivering = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const agentConnection = acp
      .agent({ name: 'backpressure-agent' })
      .onRequest(acp.methods.agent.initialize, () => ({ protocolVersion: acp.PROTOCOL_VERSION }))
      .onRequest(acp.methods.agent.session.new, () => ({ sessionId: 'backpressure-session' }))
      .onRequest(acp.methods.agent.session.prompt, async ({ client, params }) => {
        await client.notify(acp.methods.client.session.update, {
          sessionId: params.sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'complete reply' },
          },
        });
        return { stopReason: 'end_turn' };
      })
      .connect(pair.agent);
    const opening = createAcpSessionProtocolDriver().openFresh({
      definition,
      kind: 'fresh',
      parameters: {},
      permissions: {},
      transport: pair.client,
      workspace: '/workspace',
      observer: observer([]),
    });
    const opened = openedSession(await opening.completion);
    const delivered: SessionProtocolUpdate[] = [];
    let completed = false;
    const prompt = opened.session.prompt({
      prompt: 'Reply.',
      observer: {
        update: async (update) => {
          delivering.resolve();
          await release.promise;
          delivered.push(update);
        },
      },
    });
    void prompt.completion.then(() => {
      completed = true;
    });
    try {
      await delivering.promise;
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(completed).toBe(false);
      release.resolve();
      await expect(prompt.completion).resolves.toMatchObject({ status: 'completed' });
      expect(delivered).toEqual([{ type: 'message.delta', content: 'complete reply' }]);
    } finally {
      release.resolve();
      await opened.session.close();
      agentConnection.close();
    }
  },
);

test('ACP session driver keeps one provider session across turns and bridges permission', async () => {
  let remembered = '';
  let elicitationOutcome: acp.CreateElicitationResponse | undefined;
  let foreignElicitationOutcome: acp.CreateElicitationResponse | undefined;
  let foreignPermissionOutcome: acp.RequestPermissionResponse | undefined;
  let permissionOutcome: acp.RequestPermissionResponse | undefined;
  let notifyWhileIdle: (() => Promise<void>) | undefined;
  const pair = transportPair();
  const agentConnection = acp
    .agent({ name: 'fake-session-agent' })
    .onRequest(acp.methods.agent.initialize, () => ({
      agentCapabilities: protocolCapabilities,
      protocolVersion: acp.PROTOCOL_VERSION,
    }))
    .onRequest(acp.methods.agent.session.new, () => ({ sessionId: 'acp-session-1' }))
    .onRequest(acp.methods.agent.session.prompt, async (context) => {
      notifyWhileIdle = async () => {
        await context.client.notify(acp.methods.client.session.update, {
          sessionId: context.params.sessionId,
          update: {
            content: { text: 'idle-update', type: 'text' },
            sessionUpdate: 'agent_message_chunk',
          },
        });
        await context.client.request(acp.methods.client.session.requestPermission, {
          options: [],
          sessionId: 'another-session',
          toolCall: { kind: 'read', status: 'pending', title: 'Fence', toolCallId: 'idle-fence' },
        });
      };
      const promptBlock = context.params.prompt.find((block) => block.type === 'text');
      const prompt = promptBlock?.type === 'text' ? promptBlock.text : undefined;
      if (remembered.length === 0) {
        remembered = prompt ?? '';
        foreignPermissionOutcome = await context.client.request(
          acp.methods.client.session.requestPermission,
          {
            options: [],
            sessionId: 'another-session',
            toolCall: { kind: 'read', status: 'pending', title: 'Read', toolCallId: 'foreign' },
          },
        );
        foreignElicitationOutcome = await context.client.request(
          acp.methods.client.elicitation.create,
          {
            message: 'Foreign request.',
            mode: 'form',
            requestId: 'another-request',
            requestedSchema: { type: 'object' },
          },
        );
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
      await context.client.notify(acp.methods.client.session.update, {
        sessionId: context.params.sessionId,
        update: { sessionUpdate: 'unknown-update' } as never,
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
  await new Promise<void>((resolve) => setImmediate(resolve));
  await notifyWhileIdle?.();
  await new Promise<void>((resolve) => setImmediate(resolve));

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
  expect(foreignPermissionOutcome).toEqual({ outcome: { outcome: 'cancelled' } });
  expect(foreignElicitationOutcome).toEqual({ action: 'cancel' });
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
  await opening.close();
  agentConnection.close();
  await agentConnection.closed;
});

test.each([
  [{ selections: { missing: 'value' } }, 'configuration_value_unsupported'],
  [{ catalogRevision: 'stale', selections: { model: 'missing' } }, 'configuration_stale'],
] as const)(
  'ACP session driver contains configuration selection failure %#',
  async (configuration, code) => {
    const pair = transportPair();
    const configOptions: acp.SessionConfigOption[] = [
      {
        currentValue: 'one',
        id: 'model',
        name: 'Model',
        options: [{ name: 'One', value: 'one' }],
        type: 'select',
      },
    ];
    const agentConnection = acp
      .agent({ name: 'fake-configuration-agent' })
      .onRequest(acp.methods.agent.initialize, () => ({
        agentCapabilities: protocolCapabilities,
        protocolVersion: acp.PROTOCOL_VERSION,
      }))
      .onRequest(acp.methods.agent.session.new, () => ({ configOptions, sessionId: 'session' }))
      .connect(pair.agent);
    const opening = createAcpSessionProtocolDriver().openFresh({
      configuration,
      definition,
      kind: 'fresh',
      observer: observer([]),
      parameters: {},
      permissions: {},
      transport: pair.client,
      workspace: '/workspace',
    });
    await expect(opening.completion).resolves.toMatchObject({
      failure: { code },
      status: 'failed',
    });
    agentConnection.close();
    await agentConnection.closed;
  },
);

test('ACP session driver maps a handshake rejection to transport failure', async () => {
  const pair = transportPair();
  const agentConnection = acp
    .agent({ name: 'fake-failing-agent' })
    .onRequest(acp.methods.agent.initialize, () => {
      throw new Error('handshake rejected');
    })
    .connect(pair.agent);
  const opening = createAcpSessionProtocolDriver().openFresh({
    definition,
    kind: 'fresh',
    observer: observer([]),
    parameters: {},
    permissions: {},
    transport: pair.client,
    workspace: '/workspace',
  });
  await expect(opening.completion).resolves.toMatchObject({
    failure: { code: 'transport_failed' },
    status: 'failed',
  });
  agentConnection.close();
  await agentConnection.closed;
});

test.each([
  {
    capabilities: protocolCapabilities,
    continuation: { data: {}, format: 'other/v1' },
    label: 'foreign continuation format',
  },
  {
    capabilities: protocolCapabilities,
    continuation: { data: { sessionId: '' }, format: 'acp/v1' },
    label: 'empty provider session identity',
  },
  {
    capabilities: { sessionCapabilities: { close: {} } },
    continuation: { data: { sessionId: 'session' }, format: 'acp/v1' },
    label: 'unadvertised native resume',
  },
] as const)('ACP session driver rejects $label', async ({ capabilities, continuation }) => {
  const pair = transportPair();
  const agentConnection = acp
    .agent({ name: 'fake-no-resume-agent' })
    .onRequest(acp.methods.agent.initialize, () => ({
      agentCapabilities: capabilities,
      protocolVersion: acp.PROTOCOL_VERSION,
    }))
    .connect(pair.agent);
  const opening = createAcpSessionProtocolDriver().resume({
    continuation,
    definition,
    kind: 'resume',
    observer: observer([]),
    parameters: {},
    permissions: {},
    transport: pair.client,
    workspace: '/workspace',
  });
  await expect(opening.completion).resolves.toMatchObject({
    failure: { code: 'capability_unsupported' },
    status: 'unsupported',
  });
  await expect(opening.close()).resolves.toEqual({ status: 'closed' });
  await expect(
    opening.respond({ requestId: 'missing', response: { kind: 'permission', outcome: 'denied' } }),
  ).resolves.toMatchObject({ status: 'failed' });
  agentConnection.close();
  await agentConnection.closed;
});

test('ACP session driver rejects a definition without declared session capability', () => {
  const pair = transportPair();
  const invocationOnly = validateAgentDefinition(agentDefinition()).definition;
  expect(() =>
    createAcpSessionProtocolDriver().openFresh({
      definition: invocationOnly,
      kind: 'fresh',
      observer: observer([]),
      parameters: {},
      permissions: {},
      transport: pair.client,
      workspace: '/workspace',
    }),
  ).toThrow('ACP session definition lacks session capability.');
});
