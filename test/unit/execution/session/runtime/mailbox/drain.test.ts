import { expect, test } from 'vitest';

import { SerializedMailboxDrain } from '../../../../../../src/execution/session/runtime/mailbox/drain.js';
import { SessionMailboxQueue } from '../../../../../../src/execution/session/runtime/mailbox/queue.js';

test('dispatch during dispatch is appended without recursive reducer entry', () => {
  const queue = new SessionMailboxQueue<string>();
  const observed: string[] = [];
  let depth = 0;
  let maximumDepth = 0;
  let drain: SerializedMailboxDrain<string>;

  drain = new SerializedMailboxDrain(queue, (value) => {
    depth += 1;
    maximumDepth = Math.max(maximumDepth, depth);
    observed.push(value);
    if (value === 'first') {
      queue.admit('reentrant', { lane: 'reserved' });
      drain.run();
    }
    depth -= 1;
  });

  queue.admit('first', { lane: 'ordinary' });
  queue.admit('already-queued', { lane: 'ordinary' });
  drain.run();

  expect(observed).toEqual(['first', 'already-queued', 'reentrant']);
  expect(maximumDepth).toBe(1);
  expect(drain.running).toBe(false);
});
