import { expect, test } from 'vitest';

import type { AgentEvent } from '../../../../src/contracts/manager.js';
import { encodeBoundedEvents } from '../../../../src/execution/output/bounded-events.js';

const event = (invocationId: string, sequence = 1): AgentEvent => ({
  invocationId,
  pin: { agentId: 'codex', agentVersion: '1.0.0', definitionDigest: 'digest' },
  schemaVersion: 'agent-event/v1',
  sequence,
  timestamp: '2026-08-30T00:00:00.000Z',
  type: 'invocation.accepted',
});

test('rejects one serialized event above its byte limit', () => {
  expect(() =>
    encodeBoundedEvents([event('x'.repeat(300))], {
      maxEventBytes: 128,
      maxEventsFileBytes: 4_096,
    }),
  ).toThrow('Event exceeds its byte limit.');
});

test('rejects a complete events file above its byte limit', () => {
  const events = [event('first'), event('second', 2)];
  const oneEventBytes = new TextEncoder().encode(`${JSON.stringify(events[0])}\n`).byteLength;

  expect(() =>
    encodeBoundedEvents(events, {
      maxEventBytes: oneEventBytes,
      maxEventsFileBytes: oneEventBytes * 2 - 1,
    }),
  ).toThrow('Events file exceeds its byte limit.');
});

test('encodes exact-boundary NDJSON deterministically', () => {
  const events = [event('first'), event('second', 2)];
  const expected = new TextEncoder().encode(
    `${events.map((value) => JSON.stringify(value)).join('\n')}\n`,
  );

  expect(
    encodeBoundedEvents(events, {
      maxEventBytes: expected.byteLength,
      maxEventsFileBytes: expected.byteLength,
    }),
  ).toEqual(expected);
});
