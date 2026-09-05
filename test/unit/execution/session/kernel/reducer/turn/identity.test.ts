import { expect, test } from 'vitest';

import { createOpeningSessionState } from '../../../../../../../src/execution/session/kernel/reducer/opening/state.js';
import { reduceSession } from '../../../../../../../src/execution/session/kernel/reducer/reduce.js';
import { sessionOpeningCommand } from '../../../../../../support/session/builders/kernel/opening.js';
import { idleSessionState } from '../../../../../../support/session/builders/kernel/session-state.js';

const observed = { observedAt: '2026-09-05T00:00:03.000Z', observedAtMs: 3_000 };
const call = { callId: 'send', epoch: 1, sessionId: 'session_01', turnId: 'next' };

test('cancellation without a completed handle settles after session termination', () => {
  const terminal = reduceSession(createOpeningSessionState(sessionOpeningCommand()), {
    ...observed,
    call,
    type: 'session.cancel',
  }).state;
  const transition = reduceSession(terminal, {
    ...observed,
    call,
    type: 'turn.cancel',
    turnId: 'next',
  });
  expect(transition.effects).toEqual([
    expect.objectContaining({
      type: 'public.resolve',
      resolution: { kind: 'cancel_turn', result: { state: 'session_terminal' } },
    }),
  ]);
});

test('turn identity capacity rejects both pending calls before starting more work', () => {
  const state = {
    ...idleSessionState(),
    acceptedTurnIds: Array.from({ length: 10_000 }, (_, index) => `turn-${index}`),
  };
  const transition = reduceSession(state, {
    ...observed,
    call,
    type: 'turn.send',
    input: { prompt: 'Work', turnId: 'next' },
    resultCallId: 'result',
  });
  expect(transition.state.status).toBe('idle');
  expect(transition.effects).toEqual(
    ['send', 'result'].map((callId): unknown =>
      expect.objectContaining({
        type: 'public.reject',
        callId,
        fault: expect.objectContaining({ code: 'revo.agent.session_identity_capacity' }),
      }),
    ),
  );
});

test('an idle actor settles cancellation of its last completed turn', () => {
  const result = { status: 'cancelled' } as const;
  const state = {
    ...idleSessionState(),
    lastTurn: {
      status: 'cancelled' as const,
      result,
      turnId: 'previous',
      prompt: 'Work',
      handleCallId: 'handle',
      resultCallId: 'result',
    },
  };
  const transition = reduceSession(state, {
    ...observed,
    call: { ...call, turnId: 'previous' },
    type: 'turn.cancel',
    turnId: 'previous',
  });
  expect(transition.effects).toEqual([
    expect.objectContaining({
      type: 'public.resolve',
      resolution: { kind: 'cancel_turn', result: { state: 'already_completed', result } },
    }),
  ]);
});
