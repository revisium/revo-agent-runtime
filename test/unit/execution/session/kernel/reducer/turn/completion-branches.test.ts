import { expect, test } from 'vitest';

import type { AgentSessionTurnOutcome } from '../../../../../../../src/contracts/session/lifecycle/result.js';
import type { SessionEffect } from '../../../../../../../src/execution/session/kernel/effect/session-effect.js';
import type { SessionState } from '../../../../../../../src/execution/session/kernel/model/session-state.js';
import { reduceSession } from '../../../../../../../src/execution/session/kernel/reducer/reduce.js';
import {
  finishTurn,
  projectTurnResult,
  reducePromptOutcome,
} from '../../../../../../../src/execution/session/kernel/reducer/turn/completion.js';
import {
  beginProviderPrompt,
  startTurn,
} from '../../../../../../../src/execution/session/kernel/reducer/turn/start.js';
import { idleSessionState } from '../../../../../../support/session/builders/kernel/session-state.js';

type Running = Extract<SessionState, { status: 'running' }>;
const observed = { observedAt: '2026-03-21T00:00:02.000Z', observedAtMs: 2_000 } as const;
const effectOf = <Type extends SessionEffect['type']>(
  effects: readonly SessionEffect[],
  type: Type,
) =>
  effects.find(
    (candidate): candidate is Extract<SessionEffect, { type: Type }> => candidate.type === type,
  )!;

const starting = (): Running => {
  const transition = reduceSession(idleSessionState(), {
    ...observed,
    call: { callId: 'send', epoch: 1, sessionId: 'session_01', turnId: 'turn_01' },
    input: { prompt: 'Continue', turnId: 'turn_01' },
    metadata: { source: 'test' },
    resultCallId: 'result',
    type: 'turn.send',
  });
  if (transition.state.status !== 'running') throw new Error('expected running state');
  return transition.state;
};

const prompting = (): Running => {
  const state = starting();
  const append = state.events.inFlight!;
  const transition = reduceSession(state, {
    ...observed,
    correlation: append.correlation,
    result: { state: 'appended' },
    type: 'event.applied',
  });
  if (transition.state.status !== 'running') throw new Error('expected running state');
  return transition.state;
};

const streaming = (): Running => {
  const state = prompting();
  if (!('correlation' in state.turn)) throw new Error('expected prompt correlation');
  const transition = reducePromptOutcome(state, {
    ...observed,
    correlation: state.turn.correlation,
    type: 'provider.prompt.accepted',
  });
  if (transition.state.status !== 'running') throw new Error('expected running state');
  return transition.state;
};

const awaiting = (): Running => {
  const state = prompting();
  const transition = reduceSession(state, {
    ...observed,
    call: { callId: 'cancel', epoch: 1, sessionId: 'session_01', turnId: 'turn_01' },
    turnId: 'turn_01',
    type: 'turn.cancel',
  });
  if (transition.state.status !== 'running') throw new Error('expected running state');
  return transition.state;
};

const publishing = (outcome: AgentSessionTurnOutcome): Running => {
  const state = streaming();
  if (!('correlation' in state.turn)) throw new Error('expected prompt correlation');
  const transition = reducePromptOutcome(state, {
    ...observed,
    correlation: state.turn.correlation,
    outcome,
    type: 'provider.prompt.completed',
  });
  if (transition.state.status !== 'running') throw new Error('expected running state');
  return transition.state;
};

test('ignores prompt outcomes before durable admission and for mismatched prompt identity', () => {
  const early = starting();
  const command = {
    ...observed,
    correlation: { effectId: 'other', epoch: 1, sessionId: 'session_01', turnId: 'turn_01' },
    type: 'provider.prompt.accepted' as const,
  };
  expect(reducePromptOutcome(early, command)).toEqual({ effects: [], state: early });

  const active = prompting();
  expect(reducePromptOutcome(active, command)).toEqual({ effects: [], state: active });
});

test('acceptance changes prompting to streaming and refreshes inactivity', () => {
  const state = prompting();
  if (!('correlation' in state.turn)) throw new Error('expected prompt correlation');
  const transition = reducePromptOutcome(state, {
    ...observed,
    correlation: state.turn.correlation,
    type: 'provider.prompt.accepted',
  });
  expect(transition.state).toMatchObject({ status: 'running', turn: { status: 'streaming' } });
});

test('settling ignores published, foreign, and accepted provider outcomes', () => {
  const alreadyPublishing = publishing({ status: 'cancelled' });
  if (!('correlation' in alreadyPublishing.turn)) throw new Error('expected correlation');
  expect(
    reducePromptOutcome(alreadyPublishing, {
      ...observed,
      correlation: alreadyPublishing.turn.correlation,
      outcome: { status: 'completed' },
      type: 'provider.prompt.completed',
    }),
  ).toEqual({ effects: [], state: alreadyPublishing });

  const waiting = awaiting();
  if (waiting.turn.status !== 'settling' || waiting.turn.progress.stage !== 'awaiting_provider')
    throw new Error('expected awaiting cancellation');
  const foreign = { ...waiting.turn.correlation, effectId: 'foreign' };
  expect(
    reducePromptOutcome(waiting, {
      ...observed,
      correlation: foreign,
      type: 'provider.prompt.accepted',
    }),
  ).toEqual({ effects: [], state: waiting });
  expect(
    reducePromptOutcome(waiting, {
      ...observed,
      correlation: waiting.turn.progress.cancellationCorrelation,
      type: 'provider.prompt.accepted',
    }),
  ).toEqual({ effects: [], state: waiting });
});

test('a failed cancellation operation overrides the provisional turn outcome', () => {
  const state = awaiting();
  if (state.turn.status !== 'settling' || state.turn.progress.stage !== 'awaiting_provider')
    throw new Error('expected awaiting cancellation');
  const fault = {
    code: 'revo.agent.protocol_failed' as const,
    message: 'cancel failed',
    phase: 'session_running' as const,
    retryable: false,
  };
  const transition = reducePromptOutcome(state, {
    ...observed,
    correlation: state.turn.progress.cancellationCorrelation,
    fault,
    type: 'provider.prompt.failed',
  });
  expect(effectOf(transition.effects, 'event.append').event).toMatchObject({
    outcome: { error: fault, status: 'failed' },
  });
});

test('provider completion preserves the provisional cancellation outcome', () => {
  const state = awaiting();
  if (state.turn.status !== 'settling') throw new Error('expected settling');
  const transition = reducePromptOutcome(state, {
    ...observed,
    correlation: state.turn.correlation,
    outcome: { status: 'completed' },
    type: 'provider.prompt.completed',
  });
  expect(effectOf(transition.effects, 'event.append').event).toMatchObject({
    outcome: { status: 'cancelled' },
  });
});

test('projects every public result shape and rejects an unsettled result', () => {
  const waiting = awaiting();
  const waitingTurn = waiting.turn;
  if (waitingTurn.status !== 'settling') throw new Error('expected settling');
  expect(() => projectTurnResult(waitingTurn)).toThrow('Cannot project an unsettled turn result.');

  const completed = publishing({ status: 'completed' });
  if (completed.turn.status !== 'settling') throw new Error('expected settling');
  expect(projectTurnResult(completed.turn)).toMatchObject({ status: 'completed' });
  const withoutUsage: Running = {
    ...completed,
    turn: { ...completed.turn, usage: undefined } as never,
  };
  if (withoutUsage.turn.status !== 'settling') throw new Error('expected settling');
  expect(projectTurnResult(withoutUsage.turn)).not.toHaveProperty('usage');

  const failed = publishing({
    error: {
      code: 'revo.agent.protocol_failed',
      message: 'failed',
      phase: 'session_running',
      retryable: false,
    },
    status: 'failed',
  });
  if (failed.turn.status !== 'settling') throw new Error('expected settling');
  expect(projectTurnResult(failed.turn)).toMatchObject({ status: 'failed' });
  for (const status of ['cancelled', 'interrupted', 'timed_out'] as const) {
    const state = publishing({ status });
    if (state.turn.status !== 'settling') throw new Error('expected settling');
    expect(projectTurnResult(state.turn)).toEqual({ status });
  }
});

test.each([
  { status: 'completed' as const },
  {
    error: {
      code: 'revo.agent.protocol_failed' as const,
      message: 'failed',
      phase: 'session_running' as const,
      retryable: false,
    },
    status: 'failed' as const,
  },
  { status: 'cancelled' as const },
  { status: 'interrupted' as const },
  { status: 'timed_out' as const },
])('finishes a durably published $status turn', (outcome) => {
  const state = publishing(outcome);
  const transition = finishTurn(state, { effects: [], state });
  expect(transition.state).toMatchObject({ lastTurn: { status: outcome.status }, status: 'idle' });
  expect(effectOf(transition.effects, 'public.resolve')).toBeDefined();
});

test('finishTurn preserves transitions that do not satisfy its state invariants', () => {
  const active = streaming();
  expect(finishTurn(active, { effects: [], state: active })).toEqual({
    effects: [],
    state: active,
  });
  const waiting = awaiting();
  expect(finishTurn(waiting, { effects: [], state: waiting })).toEqual({
    effects: [],
    state: waiting,
  });
  const completed = publishing({ status: 'completed' });
  const idle = idleSessionState();
  expect(finishTurn(completed, { effects: [], state: idle })).toEqual({ effects: [], state: idle });
});

test('turn start ignores mismatched public and payload identities', () => {
  const state = idleSessionState();
  const transition = startTurn(state, {
    ...observed,
    call: { callId: 'send', epoch: 1, sessionId: 'session_01', turnId: 'public-turn' },
    input: { prompt: 'Continue', turnId: 'payload-turn' },
    resultCallId: 'result',
    type: 'turn.send',
  });
  expect(transition).toEqual({ effects: [], state });
});

test('provider prompt admission preserves invalid caller transitions', () => {
  const active = streaming();
  const activeTransition = { effects: [], state: active };
  expect(beginProviderPrompt(active, activeTransition)).toBe(activeTransition);

  const start = starting();
  const terminalTransition = { effects: [], state: idleSessionState() };
  expect(beginProviderPrompt(start, terminalTransition)).toBe(terminalTransition);
});
