import { expect, test } from 'vitest';

import type { SessionEffect } from '../../../../../../../src/execution/session/kernel/effect/session-effect.js';
import { reduceSession } from '../../../../../../../src/execution/session/kernel/reducer/reduce.js';
import {
  failActiveSession,
  settleRunningSession,
} from '../../../../../../../src/execution/session/kernel/reducer/terminal/control.js';
import { coalesceTerminalCommand } from '../../../../../../../src/execution/session/kernel/reducer/terminal/intent.js';
import {
  terminalizingState,
  type TerminalizingSession,
} from '../../../../../../../src/execution/session/kernel/reducer/terminal/state.js';
import type { SessionTransition } from '../../../../../../../src/execution/session/kernel/reducer/transition.js';
import { streamingSessionState } from '../../../../../../support/session/builders/kernel/running.js';
import { idleSessionState } from '../../../../../../support/session/builders/kernel/session-state.js';

const observed = { observedAt: '2026-03-21T00:01:00.000Z', observedAtMs: 60_000 } as const;
const error = {
  code: 'revo.agent.protocol_failed',
  message: 'failed',
  phase: 'session_running',
  retryable: false,
} as const;

const effectOf = <Type extends SessionEffect['type']>(
  transition: SessionTransition,
  type: Type,
): Extract<SessionEffect, { readonly type: Type }> =>
  transition.effects.find(
    (effect): effect is Extract<SessionEffect, { readonly type: Type }> => effect.type === type,
  )!;

const closing = (): TerminalizingSession => {
  const transition = reduceSession(idleSessionState(), {
    ...observed,
    call: { callId: 'close', epoch: 1, sessionId: 'session_01' },
    type: 'session.close',
  });
  return transition.state as TerminalizingSession;
};

test('projects failed and already-publishing running turns during terminal settlement', () => {
  const running = streamingSessionState();
  expect(settleRunningSession(running, { error, outcome: 'failed' }).state.intent).toEqual({
    error,
    outcome: 'failed',
  });
  const publishing = {
    ...running,
    turn: {
      ...running.turn,
      progress: {
        outcome: { status: 'completed' as const },
        stage: 'publishing_completion' as const,
      },
      status: 'settling' as const,
    },
  };
  expect(settleRunningSession(publishing, { outcome: 'cancelled' }).state.progress).toMatchObject({
    stage: 'settling_turn',
  });
  const awaitingProvider = {
    ...running,
    turn: {
      ...running.turn,
      progress: {
        cancellationCorrelation: {
          effectId: 'cancel-turn',
          epoch: running.epoch,
          sessionId: running.sessionId,
          turnId: running.turn.turnId,
        },
        outcome: { status: 'completed' as const },
        stage: 'awaiting_provider' as const,
      },
      status: 'settling' as const,
    },
  };
  expect(
    settleRunningSession(awaitingProvider, { outcome: 'cancelled' }).state.progress,
  ).toMatchObject({
    stage: 'settling_turn',
    turn: { progress: { outcome: { status: 'interrupted' }, stage: 'awaiting_provider' } },
  });
});

test('failure without a cursor and both terminalizing status projections remain explicit', () => {
  const idle = idleSessionState();
  const withoutCursor = { ...idle, events: { pending: [] as const } };
  expect(failActiveSession(withoutCursor, error).state.events).toEqual({ pending: [] });
  expect(
    terminalizingState(
      idle,
      { outcome: 'closed' },
      {
        stage: 'closing_provider',
        correlation: {
          effectId: 'close',
          epoch: 1,
          sessionId: idle.sessionId,
        },
      },
    ).status,
  ).toBe('closing');
  expect(
    terminalizingState(
      streamingSessionState(),
      { outcome: 'cancelled' },
      {
        stage: 'closing_provider',
        correlation: { effectId: 'cancel', epoch: 1, sessionId: idle.sessionId },
      },
    ).status,
  ).toBe('cancelling');
});

test('coalesces duplicate close calls and upgrades graceful close without a reason', () => {
  const state = closing();
  const duplicate = coalesceTerminalCommand(state, {
    ...observed,
    call: { callId: 'close', epoch: 1, sessionId: state.sessionId },
    type: 'session.close',
  });
  expect(duplicate.state).toBe(state);
  const cancelled = coalesceTerminalCommand(state, {
    ...observed,
    call: { callId: 'cancel', epoch: 1, sessionId: state.sessionId },
    type: 'session.cancel',
  });
  expect(cancelled.state).toMatchObject({ intent: { outcome: 'cancelled' }, status: 'cancelling' });
  const withReason = coalesceTerminalCommand(closing(), {
    ...observed,
    call: { callId: 'cancel-reason', epoch: 1, sessionId: state.sessionId },
    reason: 'stop now',
    type: 'session.cancel',
  });
  expect(withReason.state).toMatchObject({
    intent: { outcome: 'cancelled', reason: 'stop now' },
    status: 'cancelling',
  });
});

test('terminal event failure publishes output without inventing a missing cursor', () => {
  let transition: SessionTransition = { effects: [], state: closing() };
  const state = transition.state as TerminalizingSession;
  transition = reduceSession(state, {
    ...observed,
    correlation:
      state.progress.stage === 'cleaning_process'
        ? state.progress.correlation
        : { effectId: 'unexpected', epoch: 1, sessionId: state.sessionId },
    type: 'process.cleanup.confirmed',
  });
  const remove = effectOf(transition, 'persistence.remove');
  transition = reduceSession(transition.state, {
    ...observed,
    correlation: remove.correlation,
    result: { state: 'applied' },
    type: 'persistence.applied',
  });
  const append = effectOf(transition, 'event.append');
  const withoutCursor = {
    ...transition.state,
    events: { ...transition.state.events, cursor: undefined },
  } as never;
  transition = reduceSession(withoutCursor, {
    ...observed,
    correlation: append.correlation,
    fault: error,
    type: 'event.failed',
  });
  expect(effectOf(transition, 'output.publish').publication).not.toHaveProperty('cursor');
  expect(transition.state.events).toEqual({ pending: [] });
});
