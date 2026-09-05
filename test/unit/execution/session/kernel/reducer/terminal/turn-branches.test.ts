import { expect, test } from 'vitest';

import type { AgentSessionTurnOutcome } from '../../../../../../../src/contracts/session/lifecycle/result.js';
import type { SessionCommand } from '../../../../../../../src/execution/session/kernel/command/session-command.js';
import type { SessionEffect } from '../../../../../../../src/execution/session/kernel/effect/session-effect.js';
import { reduceSession } from '../../../../../../../src/execution/session/kernel/reducer/reduce.js';
import type { TerminalizingSession } from '../../../../../../../src/execution/session/kernel/reducer/terminal/state.js';
import { reduceTerminalTurn } from '../../../../../../../src/execution/session/kernel/reducer/terminal/turn.js';
import { idleSessionState } from '../../../../../../support/session/builders/kernel/session-state.js';

const observed = { observedAt: '2026-03-21T00:00:02.000Z', observedAtMs: 2_000 } as const;
const effectOf = <Type extends SessionEffect['type']>(
  effects: readonly SessionEffect[],
  type: Type,
) =>
  effects.find(
    (candidate): candidate is Extract<SessionEffect, { type: Type }> => candidate.type === type,
  )!;

const sent = () =>
  reduceSession(idleSessionState(), {
    ...observed,
    call: { callId: 'send', epoch: 1, sessionId: 'session_01', turnId: 'turn_01' },
    input: { prompt: 'Continue', turnId: 'turn_01' },
    resultCallId: 'result',
    type: 'turn.send',
  });

const prompting = () => {
  const started = sent();
  const append = effectOf(started.effects, 'event.append');
  const transition = reduceSession(started.state, {
    ...observed,
    correlation: append.correlation,
    result: { state: 'appended' },
    type: 'event.applied',
  });
  if (transition.state.status !== 'running' || !('correlation' in transition.state.turn))
    throw new Error('expected prompting turn');
  return transition.state;
};

const cancelling = (
  outcome: AgentSessionTurnOutcome = { status: 'interrupted' },
): TerminalizingSession => {
  const active = prompting();
  const transition = reduceSession(active, {
    ...observed,
    call: { callId: 'cancel-session', epoch: 1, sessionId: 'session_01' },
    reason: 'shutdown',
    type: 'session.cancel',
  });
  if (
    transition.state.status !== 'cancelling' ||
    transition.state.progress.stage !== 'settling_turn'
  )
    throw new Error('expected cancelling turn');
  const turn = transition.state.progress.turn;
  if (turn.status !== 'settling' || turn.progress.stage !== 'awaiting_provider')
    throw new Error('expected awaiting provider');
  return {
    ...transition.state,
    progress: {
      stage: 'settling_turn',
      turn: { ...turn, progress: { ...turn.progress, outcome } },
    },
  };
};

const providerCompleted = (state: TerminalizingSession): SessionCommand => {
  if (state.progress.stage !== 'settling_turn' || !('correlation' in state.progress.turn))
    throw new Error('expected correlated turn');
  return {
    ...observed,
    correlation: state.progress.turn.correlation,
    outcome: { status: 'completed' },
    type: 'provider.prompt.completed',
  };
};

test('returns undefined outside terminal turn settlement and ignores unrelated commands', () => {
  const state = cancelling();
  const outside = {
    ...state,
    progress: {
      correlation: { effectId: 'close', epoch: 1, sessionId: 'session_01' },
      stage: 'closing_provider' as const,
    },
  };
  expect(reduceTerminalTurn(outside, providerCompleted(state))).toBeUndefined();
  expect(
    reduceTerminalTurn(state, {
      ...observed,
      correlation: { effectId: 'x', epoch: 1, sessionId: 'session_01' },
      type: 'timer.fired',
      timerId: 'x',
      kind: 'operation',
      generation: 1,
      firedAt: observed.observedAt,
      firedAtMs: observed.observedAtMs,
    }),
  ).toEqual({ effects: [], state });
});

test('ignores prompt acceptance, foreign prompts, and already-publishing completion', () => {
  const state = cancelling();
  if (state.progress.stage !== 'settling_turn' || state.progress.turn.status !== 'settling')
    throw new Error('expected settling');
  const accepted = {
    ...observed,
    correlation: state.progress.turn.correlation,
    type: 'provider.prompt.accepted' as const,
  };
  expect(reduceTerminalTurn(state, accepted)).toEqual({ effects: [], state });
  expect(
    reduceTerminalTurn(state, {
      ...accepted,
      correlation: { ...accepted.correlation, effectId: 'foreign' },
      type: 'provider.prompt.failed',
      fault: {
        code: 'revo.agent.protocol_failed',
        message: 'failed',
        phase: 'session_running',
        retryable: false,
      },
    }),
  ).toEqual({ effects: [], state });

  const published = reduceTerminalTurn(state, providerCompleted(state))!;
  expect(
    reduceTerminalTurn(published.state as TerminalizingSession, providerCompleted(state)),
  ).toEqual({
    effects: [],
    state: published.state,
  });
});

test('a failed provider cancellation overrides provisional terminal turn outcome', () => {
  const state = cancelling({ status: 'cancelled' });
  if (
    state.progress.stage !== 'settling_turn' ||
    state.progress.turn.status !== 'settling' ||
    state.progress.turn.progress.stage !== 'awaiting_provider'
  )
    throw new Error('expected awaiting provider');
  const fault = {
    code: 'revo.agent.protocol_failed' as const,
    message: 'cancel failed',
    phase: 'session_running' as const,
    retryable: false,
  };
  const transition = reduceTerminalTurn(state, {
    ...observed,
    correlation: state.progress.turn.progress.cancellationCorrelation,
    fault,
    type: 'provider.prompt.failed',
  })!;
  expect(effectOf(transition.effects, 'event.append').event).toMatchObject({
    outcome: { error: fault, status: 'failed' },
  });
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
  { status: 'timed_out' as const },
  { status: 'interrupted' as const },
])('settles terminal turn result $status then begins cleanup', (outcome) => {
  const state = cancelling(outcome);
  const publishing = reduceTerminalTurn(state, providerCompleted(state))!;
  const append = effectOf(publishing.effects, 'event.append');
  const finished = reduceTerminalTurn(publishing.state as TerminalizingSession, {
    ...observed,
    correlation: append.correlation,
    result: { state: 'appended' },
    type: 'event.applied',
  })!;
  expect(finished.state).toMatchObject({
    lastTurn: { status: outcome.status },
    progress: { stage: 'cleaning_process' },
  });
  expect(effectOf(finished.effects, 'public.resolve')).toMatchObject({ callId: 'result' });
});

test('ignores non-applied, conflicted, and uncorrelated event outcomes', () => {
  const state = cancelling();
  const publishing = reduceTerminalTurn(state, providerCompleted(state))!;
  const append = effectOf(publishing.effects, 'event.append');
  const commands: SessionCommand[] = [
    {
      ...observed,
      correlation: append.correlation,
      fault: {
        code: 'revo.agent.event_sink_failed',
        message: 'failed',
        phase: 'session_delivery',
        retryable: true,
      },
      type: 'event.failed',
    },
    {
      ...observed,
      correlation: append.correlation,
      result: { state: 'conflict' },
      type: 'event.applied',
    },
    {
      ...observed,
      correlation: { ...append.correlation, effectId: 'foreign' },
      result: { state: 'appended' },
      type: 'event.applied',
    },
  ];
  for (const command of commands)
    expect(reduceTerminalTurn(publishing.state as TerminalizingSession, command)).toEqual({
      effects: [],
      state: publishing.state,
    });
});

test('acknowledges an unrelated durable event without completing the terminal turn', () => {
  const state = cancelling();
  const publication = reduceTerminalTurn(state, providerCompleted(state))!;
  const append = effectOf(publication.effects, 'event.append');
  const terminalState = publication.state as TerminalizingSession;
  const event = {
    eventId: 'session-closed',
    observedAt: observed.observedAt,
    outcome: 'cancelled' as const,
    schemaVersion: 'agent-session-event/v1' as const,
    sequence: terminalState.nextEventSequence,
    sessionId: terminalState.sessionId,
    streamId: terminalState.streamId,
    type: 'session.closed' as const,
  };
  const withUnrelatedEvent: TerminalizingSession = {
    ...terminalState,
    events: { ...terminalState.events, inFlight: { correlation: append.correlation, event } },
  };
  const transition = reduceTerminalTurn(withUnrelatedEvent, {
    ...observed,
    correlation: append.correlation,
    result: { state: 'appended' },
    type: 'event.applied',
  });
  expect(transition?.state).toMatchObject({
    events: { cursor: { eventId: 'session-closed' } },
    progress: { stage: 'settling_turn' },
  });
});

test('durable turn admission under graceful terminal intent does not start provider work', () => {
  const started = sent();
  if (started.state.status !== 'running' || started.state.turn.status !== 'starting')
    throw new Error('expected starting turn');
  const closing: TerminalizingSession = {
    ...started.state,
    callIds: ['close'],
    intent: { outcome: 'closed' as const },
    progress: { stage: 'settling_turn', turn: started.state.turn },
    status: 'closing' as const,
  };
  const append = effectOf(started.effects, 'event.append');
  const transition = reduceTerminalTurn(closing, {
    ...observed,
    correlation: append.correlation,
    result: { state: 'appended' },
    type: 'event.applied',
  })!;
  expect(transition.effects.map(({ type }) => type)).not.toContain('provider.prompt');
  expect(transition.state).toMatchObject({ status: 'closing' });
});
