import { expect, test } from 'vitest';

import type { SessionCommand } from '../../../../../../../src/execution/session/kernel/command/session-command.js';
import { reduceCheckpointControl } from '../../../../../../../src/execution/session/kernel/reducer/checkpoint/control.js';
import { reduceCheckpointEvent } from '../../../../../../../src/execution/session/kernel/reducer/checkpoint/events.js';
import type { CheckpointingState } from '../../../../../../../src/execution/session/kernel/reducer/checkpoint/state.js';
import { reduceSession } from '../../../../../../../src/execution/session/kernel/reducer/reduce.js';
import { idleSessionState } from '../../../../../../support/session/builders/kernel/session-state.js';

type EventOutcome = Extract<SessionCommand, { readonly type: `event.${string}` }>;

const observed = { observedAt: '2026-03-21T00:00:03.000Z', observedAtMs: 3_000 } as const;
const fault = {
  code: 'revo.agent.event_sink_failed' as const,
  message: 'failed',
  phase: 'session_delivery' as const,
  retryable: true,
};

const capturing = (): CheckpointingState => {
  const transition = reduceSession(idleSessionState(), {
    ...observed,
    call: { callId: 'checkpoint-call', epoch: 1, sessionId: 'session_01' },
    checkpointId: 'checkpoint',
    type: 'session.checkpoint',
  });
  if (transition.state.status !== 'checkpointing') throw new Error('expected checkpointing');
  return transition.state;
};

const publishing = (): CheckpointingState => {
  const state = capturing();
  if (state.progress.stage !== 'capturing') throw new Error('expected capturing');
  const transition = reduceSession(state, {
    ...observed,
    checkpoint: {
      checkpointId: 'checkpoint',
      cursor: { eventId: 'session_01:1:event:3', sequence: 3, streamId: 'stream_01' },
      eligibility: 'observation_only',
      payload: 'payload',
      pin: state.pin,
      schemaVersion: 'agent-session-checkpoint/v1',
      sessionId: state.sessionId,
      sha256: 'sha256',
    },
    correlation: state.progress.correlation,
    kind: 'checkpoint',
    type: 'checkpoint.captured',
  });
  if (transition.state.status !== 'checkpointing') throw new Error('expected checkpointing');
  return transition.state;
};

const applied = (
  state: CheckpointingState,
  result: 'appended' | 'conflict' = 'appended',
): EventOutcome => ({
  ...observed,
  correlation: state.events.inFlight!.correlation,
  result: { state: result },
  type: 'event.applied',
});

test('ignores event outcomes outside checkpoint publication or with foreign correlation', () => {
  const capture = capturing();
  const publication = publishing();
  expect(reduceCheckpointEvent(capture, applied(publication))).toEqual({
    effects: [],
    state: capture,
  });
  const foreign = {
    ...applied(publication),
    correlation: { ...publication.events.inFlight!.correlation, effectId: 'foreign' },
  };
  expect(reduceCheckpointEvent(publication, foreign)).toEqual({ effects: [], state: publication });
});

test.each(['event.failed', 'event.unknown', 'event.timed_out_then_failed'] as const)(
  'fails the active session on %s',
  (type) => {
    const state = publishing();
    const transition = reduceCheckpointEvent(state, {
      ...observed,
      correlation: state.events.inFlight!.correlation,
      fault,
      type,
    });
    expect(transition.state).toMatchObject({ intent: { outcome: 'failed' }, status: 'cancelling' });
    expect(transition.effects.at(-1)).toMatchObject({
      callId: 'checkpoint-call',
      type: 'public.reject',
    });
  },
);

test.each(['event.applied', 'event.timed_out_then_applied'] as const)(
  'maps a conflicted %s acknowledgement to event conflict',
  (type) => {
    const state = publishing();
    const transition = reduceCheckpointEvent(state, {
      ...observed,
      correlation: state.events.inFlight!.correlation,
      result: { state: 'conflict' },
      type,
    });
    expect(transition.effects.at(-1)).toMatchObject({
      fault: { code: 'revo.agent.event_conflict' },
      type: 'public.reject',
    });
  },
);

test('ignores a successfully appended event of the wrong semantic type', () => {
  const source = publishing();
  const correlation = source.events.inFlight!.correlation;
  const wrongEvent = {
    eventId: 'wrong-event',
    observedAt: observed.observedAt,
    schemaVersion: 'agent-session-event/v1' as const,
    sequence: source.nextEventSequence,
    sessionId: source.sessionId,
    streamId: source.streamId,
    turnId: 'turn',
    type: 'turn.started' as const,
  };
  const state: CheckpointingState = {
    ...source,
    events: { ...source.events, inFlight: { correlation, event: wrongEvent } },
  };
  expect(reduceCheckpointEvent(state, applied(state))).toEqual({ effects: [], state });
});

test('starts deferred cancellation cleanup without inventing an absent reason', () => {
  const source = publishing();
  const deferred = reduceCheckpointControl(source, {
    ...observed,
    call: { callId: 'cancel', epoch: 1, sessionId: source.sessionId },
    type: 'session.cancel',
  });
  if (deferred.state.status !== 'checkpointing') throw new Error('expected checkpointing');

  const transition = reduceCheckpointEvent(deferred.state, applied(deferred.state));
  expect(
    transition.effects.filter(
      ({ type }) => type === 'provider.close' || type === 'process.cleanup',
    ),
  ).toEqual([
    expect.not.objectContaining({ reason: expect.anything() }),
    expect.not.objectContaining({ reason: expect.anything() }),
  ]);
});
