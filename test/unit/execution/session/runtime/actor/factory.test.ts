import { expect, test } from 'vitest';

import type { SessionReducer } from '../../../../../../src/execution/session/kernel/reducer/transition.js';
import { SessionActorFactory } from '../../../../../../src/execution/session/runtime/actor/factory.js';
import type { SessionCommandDispatch } from '../../../../../../src/execution/session/runtime/actor/port.js';
import { SessionEffectDispatcher } from '../../../../../../src/execution/session/runtime/effects/dispatcher.js';
import type { SessionClock } from '../../../../../../src/execution/session/runtime/timing/clock.js';
import { idleSessionState } from '../../../../../support/session/builders/kernel/session-state.js';

const clock: SessionClock = {
  now: () => ({ iso: '2026-09-05T00:00:00.000Z', milliseconds: 1_000 }),
  schedule: () => ({ cancel: () => undefined }),
};
const reducer: SessionReducer = (state) => ({
  effects: [],
  state: { ...state, nextEventSequence: state.nextEventSequence + 1 },
});

test('factory creates isolated actors behind the narrow public-command dispatch port', () => {
  const factory = new SessionActorFactory({
    clock,
    dispatcher: new SessionEffectDispatcher([]),
    reducer,
  });
  const first = factory.create(idleSessionState());
  const second = factory.create(idleSessionState());
  const dispatch: SessionCommandDispatch = first;

  dispatch.dispatch({
    call: { callId: 'close_01', epoch: 1, sessionId: 'session_01' },
    observedAt: '2026-09-05T00:00:00.000Z',
    observedAtMs: 1_000,
    type: 'session.close',
  });

  expect(first.state.nextEventSequence).toBe(4);
  expect(second.state.nextEventSequence).toBe(3);
});
