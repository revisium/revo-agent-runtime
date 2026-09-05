import { expect, test } from 'vitest';

import { createOpeningSessionState } from '../../../../../../../src/execution/session/kernel/reducer/opening/state.js';
import { reduceSession } from '../../../../../../../src/execution/session/kernel/reducer/reduce.js';
import { sessionOpeningCommand } from '../../../../../../support/session/builders/kernel/opening.js';
import { idleSessionState } from '../../../../../../support/session/builders/kernel/session-state.js';

const observed = { observedAt: '2026-09-05T00:00:03.000Z', observedAtMs: 3_000 };
const call = { callId: 'control', epoch: 1, sessionId: 'session_01' };
const correlation = { effectId: 'process-start', epoch: 1, sessionId: 'session_01' };
const fault = {
  code: 'revo.agent.protocol_failed',
  message: 'Process exited.',
  phase: 'session_running',
  retryable: false,
} as const;
const exit = {
  ...observed,
  correlation,
  fault,
  processResourceId: 'process_01',
  type: 'process.exited',
} as const;

const openingWithProcess = (stage: 'saving_process' | 'opening_provider') => ({
  ...createOpeningSessionState(sessionOpeningCommand()),
  progress: {
    stage,
    correlation,
    process: idleSessionState().process,
    processResourceId: 'process_01',
    preparationId: 'prepared',
    resumed: false,
  },
});

test.each(['saving_process', 'opening_provider'] as const)(
  'reaps an exited opening process during %s',
  (stage) => {
    const state = openingWithProcess(stage);
    const transition = reduceSession(state, exit);
    expect(transition.state).toMatchObject({
      progress: {
        stage: 'cleaning_process',
        afterCleanup: stage === 'saving_process' ? 'uncertain' : 'remove_state',
      },
    });
    expect(transition.effects).toEqual([
      expect.objectContaining({ type: 'process.cleanup', processResourceId: 'process_01' }),
    ]);
    expect(reduceSession(transition.state, exit)).toEqual({ state: transition.state, effects: [] });
    expect(reduceSession(state, { ...exit, processResourceId: 'foreign' })).toEqual({
      state,
      effects: [],
    });
  },
);

test('ignores exits that have no owned process or belong to a different live resource', () => {
  const opening = createOpeningSessionState(sessionOpeningCommand());
  expect(reduceSession(opening, exit)).toEqual({ state: opening, effects: [] });
  const terminal = reduceSession(opening, { ...observed, call, type: 'session.cancel' }).state;
  expect(reduceSession(terminal, exit)).toEqual({ state: terminal, effects: [] });
  const idle = idleSessionState();
  expect(reduceSession(idle, { ...exit, processResourceId: 'foreign' })).toEqual({
    state: idle,
    effects: [],
  });
  const closing = reduceSession(idle, { ...observed, call, type: 'session.close' }).state;
  expect(reduceSession(closing, exit)).toEqual({ state: closing, effects: [] });
});

test.each(['session.checkpoint', 'session.hibernate'] as const)(
  'rejects the pending %s call on process exit',
  (type) => {
    const command =
      type === 'session.checkpoint'
        ? { ...observed, call, type, checkpointId: 'checkpoint' }
        : { ...observed, call, type, resumeTokenId: 'resume' };
    const pending = reduceSession(idleSessionState(), command);
    const transition = reduceSession(pending.state, exit);
    expect(transition.state).toMatchObject({
      status: 'cancelling',
      intent: { outcome: 'failed', error: fault },
    });
    expect(transition.effects).toContainEqual(
      expect.objectContaining({ type: 'public.reject', callId: 'control', fault }),
    );
    expect(transition.effects).toContainEqual(expect.objectContaining({ type: 'process.cleanup' }));
  },
);

test('cancelling during process persistence keeps cleanup ownership uncertain', () => {
  const transition = reduceSession(openingWithProcess('saving_process'), {
    ...observed,
    call,
    type: 'manager.shutdown',
  });
  expect(transition.state).toMatchObject({
    progress: { stage: 'cleaning_process', afterCleanup: 'uncertain' },
  });
  expect(transition.effects).toContainEqual(
    expect.objectContaining({ type: 'public.resolve', callId: 'control' }),
  );
});

test('a duplicate start notification cannot clean an admitted process', () => {
  const state = idleSessionState();
  expect(
    reduceSession(state, {
      ...observed,
      correlation,
      process: state.process,
      processResourceId: state.processResourceId,
      type: 'process.started',
    }),
  ).toEqual({ state, effects: [] });
});
