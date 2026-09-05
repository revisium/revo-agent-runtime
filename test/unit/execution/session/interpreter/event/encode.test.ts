import { describe, expect, it } from 'vitest';

import type { PlanUpdatedEvent } from '../../../../../../src/contracts/session/events/event.js';
import {
  SessionEventEncodingError,
  snapshotSessionEvent,
} from '../../../../../../src/execution/session/interpreter/event/encode.js';

const planEvent = (
  item = { itemId: 'item-1', status: 'in_progress' as const, title: 'Inspect' },
): PlanUpdatedEvent => ({
  eventId: 'event-1',
  items: [item],
  observedAt: '2026-09-05T00:00:00.000Z',
  schemaVersion: 'agent-session-event/v1',
  sequence: 1,
  sessionId: 'session-1',
  streamId: 'stream-1',
  turnId: 'turn-1',
  type: 'plan.updated',
});

describe('session event snapshot', () => {
  it('owns and deeply freezes the value delivered to a sink', () => {
    const item = { itemId: 'item-1', status: 'in_progress' as const, title: 'Inspect' };
    const source = planEvent(item);
    const snapshot = snapshotSessionEvent(source, 2_048);
    item.title = 'mutated';

    expect(snapshot).not.toBe(source);
    expect(snapshot).toMatchObject({ items: [{ title: 'Inspect' }] });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.items)).toBe(true);
    expect(Object.isFrozen(snapshot.items[0])).toBe(true);
  });

  it('rejects an event that exceeds its encoded byte budget', () => {
    expect(() => snapshotSessionEvent(planEvent(), 32)).toThrow(SessionEventEncodingError);
  });
});
