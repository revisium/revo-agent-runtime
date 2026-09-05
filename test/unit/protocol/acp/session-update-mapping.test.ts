import type * as acp from '@agentclientprotocol/sdk';
import { expect, test } from 'vitest';

import {
  deliverAcpSessionUpdate,
  mapAcpSessionUpdate,
} from '../../../../src/protocol/acp/session/mapping/updates.js';

const update = (value: unknown): acp.SessionUpdate => value as acp.SessionUpdate;

test('merges sparse updates, resets reused call identities, and bounds the per-turn cache', () => {
  const tools: NonNullable<Parameters<typeof mapAcpSessionUpdate>[1]> = new Map();
  mapAcpSessionUpdate(
    update({
      sessionUpdate: 'tool_call',
      toolCallId: 'tool-1',
      title: 'Read config',
      kind: 'read',
      status: 'in_progress',
    }),
    tools,
  );
  expect(
    mapAcpSessionUpdate(
      update({ sessionUpdate: 'tool_call_update', toolCallId: 'tool-1', status: 'completed' }),
      tools,
    ),
  ).toMatchObject({ title: 'Read config', kind: 'read', status: 'completed' });
  expect(
    mapAcpSessionUpdate(
      update({ sessionUpdate: 'tool_call_update', toolCallId: 'tool-1', title: 'Done' }),
      tools,
    ),
  ).toMatchObject({ title: 'Done', kind: 'read', status: 'completed' });
  expect(
    mapAcpSessionUpdate(
      update({ sessionUpdate: 'tool_call', toolCallId: 'tool-1', title: 'New call' }),
      tools,
    ),
  ).toMatchObject({ title: 'New call', kind: 'other', status: 'started' });
  for (let index = 0; index < 1_024; index++) {
    mapAcpSessionUpdate(
      update({ sessionUpdate: 'tool_call', toolCallId: `other-${index}`, title: 'Other' }),
      tools,
    );
  }
  expect(tools.size).toBe(1_024);
  expect(tools.has('tool-1')).toBe(false);
});

test('delivers a status-only tool completion', () => {
  expect(
    mapAcpSessionUpdate(
      update({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tool-1',
        status: 'completed',
      }),
    ),
  ).toMatchObject({ type: 'tool', toolCallId: 'tool-1', status: 'completed' });
});

test('maps non-empty assistant text and ignores unsupported message content', () => {
  expect(
    mapAcpSessionUpdate(
      update({
        content: { text: 'hello', type: 'text' },
        sessionUpdate: 'agent_message_chunk',
      }),
    ),
  ).toEqual({ content: 'hello', type: 'message.delta' });
  expect(
    mapAcpSessionUpdate(
      update({ content: { text: '', type: 'text' }, sessionUpdate: 'agent_message_chunk' }),
    ),
  ).toBeUndefined();
  expect(
    mapAcpSessionUpdate(
      update({
        content: { data: '', mimeType: 'image/png', type: 'image' },
        sessionUpdate: 'agent_message_chunk',
      }),
    ),
  ).toBeUndefined();
});

test.each([
  ['read', 'completed', 'read', 'completed'],
  ['think', 'pending', 'other', 'started'],
  ['switch_mode', undefined, 'other', 'started'],
  [undefined, null, 'other', 'started'],
  [null, 'in_progress', 'other', 'in_progress'],
] as const)('maps ACP tool kind %s and status %s', (kind, status, expectedKind, expectedStatus) => {
  expect(
    mapAcpSessionUpdate(
      update({
        kind,
        sessionUpdate: 'tool_call',
        status,
        title: 'Inspect',
        toolCallId: 'tool-1',
      }),
    ),
  ).toEqual({
    kind: expectedKind,
    status: expectedStatus,
    title: 'Inspect',
    toolCallId: 'tool-1',
    type: 'tool',
  });
});

test('maps titled tool updates and ignores untitled partial updates', () => {
  expect(
    mapAcpSessionUpdate(
      update({
        kind: 'execute',
        sessionUpdate: 'tool_call_update',
        status: 'failed',
        title: 'Run',
        toolCallId: 'tool-2',
      }),
    ),
  ).toEqual({
    kind: 'execute',
    status: 'failed',
    title: 'Run',
    toolCallId: 'tool-2',
    type: 'tool',
  });
  expect(
    mapAcpSessionUpdate(
      update({ sessionUpdate: 'tool_call_update', title: null, toolCallId: 'tool-2' }),
    ),
  ).toBeUndefined();
});

test('maps ordered plan entries and ignores unknown updates', () => {
  expect(
    mapAcpSessionUpdate(
      update({
        entries: [
          { content: 'Inspect', priority: 'high', status: 'in_progress' },
          { content: 'Fix', priority: 'medium', status: 'pending' },
        ],
        sessionUpdate: 'plan',
      }),
    ),
  ).toEqual({
    items: [
      { itemId: 'item_1', status: 'in_progress', title: 'Inspect' },
      { itemId: 'item_2', status: 'pending', title: 'Fix' },
    ],
    type: 'plan',
  });
  expect(mapAcpSessionUpdate(update({ sessionUpdate: 'agent_thought_chunk' }))).toBeUndefined();
});

test('delivers only mapped updates while an observer is attached', async () => {
  const delivered: unknown[] = [];
  const observer = { update: async (value: unknown) => void delivered.push(value) };
  const message = update({
    content: { text: 'hello', type: 'text' },
    sessionUpdate: 'agent_message_chunk',
  });

  await deliverAcpSessionUpdate(observer, message);
  await deliverAcpSessionUpdate(undefined, message);
  await deliverAcpSessionUpdate(observer, update({ sessionUpdate: 'agent_thought_chunk' }));

  expect(delivered).toEqual([{ content: 'hello', type: 'message.delta' }]);
});
