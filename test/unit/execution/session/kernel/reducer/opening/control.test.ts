import { expect, test } from 'vitest';

import { createOpeningSessionState } from '../../../../../../../src/execution/session/kernel/reducer/opening/state.js';
import { reduceSession } from '../../../../../../../src/execution/session/kernel/reducer/reduce.js';
import { sessionOpeningCommand } from '../../../../../../support/session/builders/kernel/opening.js';
import { idleSessionState } from '../../../../../../support/session/builders/kernel/session-state.js';

const observed = { observedAt: '2026-09-05T00:00:03.000Z', observedAtMs: 3_000 };
const correlation = { effectId: 'save-process', epoch: 1, sessionId: 'session_01' };
const cancel = {
  ...observed,
  call: { callId: 'cancel', epoch: 1, sessionId: 'session_01' },
  type: 'session.cancel',
} as const;
const opening = createOpeningSessionState(sessionOpeningCommand());
const owned = idleSessionState();
const saving = {
  ...opening,
  progress: {
    stage: 'saving_process' as const,
    correlation,
    preparationId: 'prepared',
    resumed: false,
    process: owned.process,
    processResourceId: owned.processResourceId,
  },
};

test('repeated cancellation preserves the pending cleanup owner and its uncertainty', () => {
  const first = reduceSession(saving, cancel);
  const repeated = reduceSession(first.state, {
    ...cancel,
    call: { ...cancel.call, callId: 'again' },
  });
  expect(repeated.state).toMatchObject({
    progress: {
      stage: 'cleaning_process',
      correlation: first.effects[0]?.correlation,
      afterCleanup: 'uncertain',
    },
  });
  expect(repeated.effects).toEqual([
    expect.objectContaining({ type: 'public.resolve', callId: 'again' }),
  ]);
});

test('cancellation cannot finalize an opening before its pending state removal settles', () => {
  const state = {
    ...opening,
    progress: {
      stage: 'removing_state' as const,
      correlation,
      fault: {
        code: 'revo.agent.cancelled' as const,
        message: 'Cancelled',
        phase: 'session_opening' as const,
        retryable: false,
      },
    },
  };
  const repeated = reduceSession(state, cancel);
  expect(repeated.state).toMatchObject({ status: 'opening', progress: state.progress });
  expect(repeated.effects).toEqual([expect.objectContaining({ type: 'public.resolve' })]);
});

test('opening cleanup closes an already-open provider and cancels its lifecycle timers', () => {
  const state = {
    ...opening,
    timers: owned.timers,
    progress: {
      stage: 'publishing_opened' as const,
      process: owned.process,
      processResourceId: owned.processResourceId,
      providerResourceId: owned.providerResourceId,
      capabilities: owned.capabilities,
      openedAtMs: 2_000,
      resumed: false,
    },
  };
  const transition = reduceSession(state, cancel);
  expect(transition.state.timers).toEqual([]);
  expect(transition.effects).toContainEqual(
    expect.objectContaining({
      type: 'provider.close',
      providerResourceId: owned.providerResourceId,
    }),
  );
  expect(transition.effects).toContainEqual(expect.objectContaining({ type: 'process.cleanup' }));
});
