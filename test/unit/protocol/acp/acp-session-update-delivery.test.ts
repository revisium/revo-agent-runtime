import type * as acp from '@agentclientprotocol/sdk';
import { expect, test } from 'vitest';

import { AcpSessionUpdateDelivery } from '../../../../src/protocol/acp/session/update-delivery.js';

const message = (text: string): acp.SessionUpdate => ({
  sessionUpdate: 'agent_message_chunk',
  content: { type: 'text', text },
});

test('completion waits for ordered delivery under observer backpressure', async () => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const delivered: string[] = [];
  const delivery = new AcpSessionUpdateDelivery(() => ({
    update: async (value) => {
      entered.resolve();
      await release.promise;
      if (value.type === 'message.delta') delivered.push(value.content);
    },
  }));
  const first = delivery.deliver(message('first'));
  const second = delivery.deliver(message('second'));
  const idle = delivery.whenIdle();
  await entered.promise;
  expect(delivered).toEqual([]);
  release.resolve();
  await Promise.all([first, second, idle]);
  expect(delivered).toEqual(['first', 'second']);
});

test('observer failure rejects both delivery and its completion fence', async () => {
  const delivery = new AcpSessionUpdateDelivery(() => ({
    update: async () => {
      throw new Error('consumer failed');
    },
  }));
  await expect(delivery.deliver(message('reply'))).rejects.toThrow('consumer failed');
  await expect(delivery.whenIdle()).rejects.toThrow('consumer failed');
});

test('an idle delivery lane is already drained', async () => {
  const delivery = new AcpSessionUpdateDelivery(() => undefined);
  await expect(delivery.whenIdle()).resolves.toBeUndefined();
});
