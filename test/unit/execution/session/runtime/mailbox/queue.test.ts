import { describe, expect, test } from 'vitest';

import {
  MAILBOX_LIMITS,
  SessionMailboxQueue,
} from '../../../../../../src/execution/session/runtime/mailbox/queue.js';

describe('session mailbox queue', () => {
  test('dequeues every admitted lane in global ticket order', () => {
    const queue = new SessionMailboxQueue<string>();

    expect(queue.admit('public', { lane: 'ordinary' })).toMatchObject({ ticket: 0 });
    expect(queue.admit('outcome', { lane: 'reserved' })).toMatchObject({ ticket: 1 });
    expect(queue.admit('update', { lane: 'provider_update' })).toMatchObject({ ticket: 2 });
    expect(queue.admit('cancel', { key: 'cancel', lane: 'control' })).toMatchObject({ ticket: 3 });

    expect([
      queue.take()?.value,
      queue.take()?.value,
      queue.take()?.value,
      queue.take()?.value,
    ]).toEqual(['public', 'outcome', 'update', 'cancel']);
    expect(queue.take()).toBeUndefined();
  });

  test('bounds ordinary and non-cooperative provider ingress independently', () => {
    const queue = new SessionMailboxQueue<number>();

    for (let index = 0; index < MAILBOX_LIMITS.ordinary; index += 1)
      expect(queue.admit(index, { lane: 'ordinary' }).state).toBe('accepted');
    expect(queue.admit(999, { lane: 'ordinary' }).state).toBe('rejected');

    for (let index = 0; index < MAILBOX_LIMITS.providerUpdates; index += 1)
      expect(queue.admit(index, { lane: 'provider_update' }).state).toBe('accepted');
    expect(queue.admit(999, { lane: 'provider_update' }).state).toBe('rejected');

    expect(queue.size).toBe(MAILBOX_LIMITS.ordinary + MAILBOX_LIMITS.providerUpdates);
  });

  test.each(['cancel', 'close', 'shutdown'] as const)(
    'admits and coalesces the %s control slot while ordinary traffic is saturated',
    (key) => {
      const queue = new SessionMailboxQueue<string>();
      for (let index = 0; index < MAILBOX_LIMITS.ordinary; index += 1)
        queue.admit(`ordinary-${index}`, { lane: 'ordinary' });

      const leader = queue.admit(`${key}-leader`, { key, lane: 'control' });
      const follower = queue.admit(`${key}-follower`, { key, lane: 'control' });

      expect(leader).toMatchObject({ state: 'accepted' });
      expect(follower).toEqual({
        leader: `${key}-leader`,
        state: 'coalesced',
        ticket: leader.ticket,
      });
    },
  );
});
