import type * as acp from '@agentclientprotocol/sdk';
import { expect, test, vi } from 'vitest';

import { AcpSessionInteractionBroker } from '../../../../src/protocol/acp/session/interaction/broker.js';
import type { SessionProtocolUpdate } from '../../../../src/protocol/session/model/update.js';

const permissionRequest = {
  options: [{ kind: 'allow_once', name: 'Allow once', optionId: 'allow' }],
  sessionId: 'provider-session',
  toolCall: { kind: 'execute', status: 'pending', title: 'Run', toolCallId: 'tool' },
} as acp.RequestPermissionRequest;

const inputRequest = {
  message: 'Choose tasks.',
  mode: 'form',
  requestedSchema: {
    properties: {
      tasks: { items: { enum: ['tests', 'docs'] }, type: 'array' },
    },
    required: ['tasks'],
    type: 'object',
  },
  sessionId: 'provider-session',
} as acp.CreateElicitationRequest;

test('publishes permission requests and accepts selected and denied answers', async () => {
  let broker: AcpSessionInteractionBroker;
  const updates: SessionProtocolUpdate[] = [];
  const observer = {
    update: vi.fn(async (update: SessionProtocolUpdate) => {
      updates.push(update);
      const request = update.type === 'interaction.requested' ? update.request : undefined;
      expect(request?.kind).toBe('permission');
      expect(
        broker.respond({
          requestId: request?.requestId ?? '',
          response:
            updates.length === 1
              ? { kind: 'permission', optionId: 'allow', outcome: 'selected' }
              : { kind: 'permission', outcome: 'denied' },
        }),
      ).toEqual({ status: 'accepted' });
    }),
  };
  broker = new AcpSessionInteractionBroker(() => observer, { input: true, permission: true });

  await expect(broker.permission(permissionRequest)).resolves.toEqual({
    outcome: { optionId: 'allow', outcome: 'selected' },
  });
  await expect(broker.permission(permissionRequest)).resolves.toEqual({
    outcome: { outcome: 'cancelled' },
  });
  expect(
    updates.map((update) => update.type === 'interaction.requested' && update.request.requestId),
  ).toEqual(['req_acp_1', 'req_acp_2']);
});

test('publishes structured input and maps submitted, declined, and cancelled answers', async () => {
  let broker: AcpSessionInteractionBroker;
  const outcomes = ['submitted', 'declined', 'cancelled'] as const;
  let index = 0;
  const observer = {
    update: async (update: SessionProtocolUpdate) => {
      if (update.type !== 'interaction.requested') throw new Error('unexpected update');
      const outcome = outcomes[index++]!;
      expect(
        broker.respond({
          requestId: update.request.requestId,
          response:
            outcome === 'submitted'
              ? { kind: 'input', outcome, values: { tasks: ['tests', 'docs'] } }
              : { kind: 'input', outcome },
        }),
      ).toEqual({ status: 'accepted' });
    },
  };
  broker = new AcpSessionInteractionBroker(() => observer, { input: true, permission: true });

  await expect(broker.elicitation(inputRequest)).resolves.toEqual({
    action: 'accept',
    content: { tasks: ['tests', 'docs'] },
  });
  await expect(broker.elicitation(inputRequest)).resolves.toEqual({ action: 'decline' });
  await expect(broker.elicitation(inputRequest)).resolves.toEqual({ action: 'cancel' });
});

test('rejects unsupported, malformed, missing-observer, and mismatched interactions', async () => {
  const unsupported = new AcpSessionInteractionBroker(() => undefined, {
    input: false,
    permission: false,
  });
  await expect(unsupported.permission(permissionRequest)).resolves.toEqual({
    outcome: { outcome: 'cancelled' },
  });
  await expect(unsupported.elicitation(inputRequest)).resolves.toEqual({ action: 'cancel' });

  const broker = new AcpSessionInteractionBroker(() => undefined, {
    input: true,
    permission: true,
  });
  await expect(broker.permission(permissionRequest)).rejects.toThrow(
    'ACP interaction has no active session observer.',
  );
  await expect(broker.elicitation({ ...inputRequest, mode: 'url' })).resolves.toEqual({
    action: 'cancel',
  });
  expect(
    broker.respond({
      requestId: 'unknown',
      response: { kind: 'permission', outcome: 'denied' },
    }),
  ).toMatchObject({ failure: { code: 'interaction_rejected' }, status: 'failed' });
});

test('rejects a response of the wrong kind and cancels every pending interaction', async () => {
  const published: string[] = [];
  let releasePublished: (() => void) | undefined;
  const allPublished = new Promise<void>((resolve) => {
    releasePublished = resolve;
  });
  const observer = {
    update: async (update: SessionProtocolUpdate) => {
      if (update.type !== 'interaction.requested') throw new Error('unexpected update');
      published.push(update.request.requestId);
      if (published.length === 2) releasePublished?.();
    },
  };
  const broker = new AcpSessionInteractionBroker(() => observer, {
    input: true,
    permission: true,
  });
  const permission = broker.permission(permissionRequest);
  const input = broker.elicitation(inputRequest);
  await allPublished;

  expect(
    broker.respond({
      requestId: published[0] ?? '',
      response: { kind: 'input', outcome: 'cancelled' },
    }),
  ).toMatchObject({ failure: { code: 'interaction_rejected' }, status: 'failed' });
  expect(
    broker.respond({
      requestId: published[1] ?? '',
      response: { kind: 'permission', outcome: 'denied' },
    }),
  ).toMatchObject({ failure: { code: 'interaction_rejected' }, status: 'failed' });
  broker.cancelPending();
  await expect(permission).resolves.toEqual({ outcome: { outcome: 'cancelled' } });
  await expect(input).resolves.toEqual({ action: 'cancel' });
  broker.cancelPending();
});
