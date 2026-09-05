import { expect, test } from 'vitest';

import type { TimerCommand } from '../../../../../../../src/execution/session/kernel/command/timer.js';
import { reduceCheckpointControl } from '../../../../../../../src/execution/session/kernel/reducer/checkpoint/control.js';
import type { CheckpointingState } from '../../../../../../../src/execution/session/kernel/reducer/checkpoint/state.js';
import { reduceSession } from '../../../../../../../src/execution/session/kernel/reducer/reduce.js';
import { idleSessionState } from '../../../../../../support/session/builders/kernel/session-state.js';

const observed = { observedAt: '2026-03-21T00:00:03.000Z', observedAtMs: 3_000 } as const;
const checkpointCommand = {
  ...observed,
  call: { callId: 'checkpoint-call', epoch: 1, sessionId: 'session_01' },
  checkpointId: 'checkpoint',
  type: 'session.checkpoint',
} as const;
const cancel = {
  ...observed,
  call: { callId: 'cancel-call', epoch: 1, sessionId: 'session_01' },
  reason: 'stop',
  type: 'session.cancel',
} as const;

const capturing = (): CheckpointingState => {
  const transition = reduceSession(idleSessionState(), checkpointCommand);
  if (transition.state.status !== 'checkpointing') throw new Error('expected checkpointing');
  return transition.state;
};

const publishing = (): CheckpointingState => {
  const state = capturing();
  if (state.progress.stage !== 'capturing') throw new Error('expected capture');
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

const timer = (state: CheckpointingState, overrides: Partial<TimerCommand> = {}): TimerCommand => {
  const wall = state.timers.find(({ kind }) => kind === 'wall_clock')!;
  return {
    correlation: { effectId: 'timer', epoch: 1, sessionId: state.sessionId },
    firedAt: observed.observedAt,
    firedAtMs: observed.observedAtMs,
    generation: wall.generation,
    kind: wall.kind,
    timerId: wall.timerId,
    type: 'timer.fired',
    ...overrides,
  };
};

test('graceful close is rejected while checkpointing', () => {
  const state = capturing();
  const transition = reduceCheckpointControl(state, {
    ...observed,
    call: { callId: 'close', epoch: 1, sessionId: state.sessionId },
    type: 'session.close',
  });
  expect(transition.effects.at(-1)).toMatchObject({
    fault: { code: 'revo.agent.session_busy' },
    type: 'public.reject',
  });
});

test.each([{ timerId: 'wrong' }, { generation: 99 }, { kind: 'idle' as const }] as const)(
  'ignores stale checkpoint timer %#',
  (overrides) => {
    const state = capturing();
    expect(reduceCheckpointControl(state, timer(state, overrides))).toEqual({ effects: [], state });
  },
);

test('cancellation interrupts capture and rejects the checkpoint call', () => {
  const transition = reduceCheckpointControl(capturing(), cancel);
  expect(transition.state).toMatchObject({
    intent: { outcome: 'cancelled' },
    status: 'cancelling',
  });
  expect(transition.effects.at(-1)).toMatchObject({
    fault: { code: 'revo.agent.cancelled' },
    type: 'public.reject',
  });
});

test.each(['wall_clock', 'idle'] as const)('%s timeout interrupts checkpoint capture', (kind) => {
  const source = capturing();
  const timerState =
    kind === 'idle'
      ? { deadlineMs: 4_000, generation: 2, kind, timerId: 'idle-timer' }
      : source.timers.find((candidate) => candidate.kind === kind)!;
  const state: CheckpointingState = {
    ...source,
    timers: kind === 'idle' ? [...source.timers, timerState] : source.timers,
  };
  const transition = reduceCheckpointControl(
    state,
    timer(state, {
      generation: timerState.generation,
      kind,
      timerId: timerState.timerId,
    }),
  );
  expect(transition.state).toMatchObject({
    intent: {
      outcome: 'timed_out',
      timeout: kind === 'idle' ? 'idle_timeout' : 'wall_clock_timeout',
    },
    status: 'cancelling',
  });
  expect(transition.effects.at(-1)).toMatchObject({ fault: { code: 'revo.agent.timeout' } });
});

test('cancellation is deferred behind durable checkpoint publication and coalesced afterwards', () => {
  const state = publishing();
  const first = reduceCheckpointControl(state, cancel);
  expect(first.state).toMatchObject({
    terminalAfterCheckpoint: { outcome: 'cancelled', reason: 'stop' },
  });
  expect(first.effects.at(-1)).toMatchObject({
    resolution: { kind: 'cancel_session', result: { state: 'requested' } },
  });
  const second = reduceCheckpointControl(first.state as CheckpointingState, {
    ...cancel,
    call: { ...cancel.call, callId: 'second-cancel' },
  });
  expect(second.effects).toEqual([
    expect.objectContaining({ callId: 'second-cancel', type: 'public.resolve' }),
  ]);
});

test.each(['wall_clock', 'idle'] as const)(
  'defers %s timeout behind checkpoint publication',
  (kind) => {
    const source = publishing();
    const timerState =
      kind === 'idle'
        ? { deadlineMs: 4_000, generation: 2, kind, timerId: 'idle-timer' }
        : source.timers.find((candidate) => candidate.kind === kind)!;
    const state: CheckpointingState = {
      ...source,
      timers: kind === 'idle' ? [...source.timers, timerState] : source.timers,
    };
    const command = timer(state, {
      generation: timerState.generation,
      kind,
      timerId: timerState.timerId,
    });
    const first = reduceCheckpointControl(state, command);
    expect(first.state).toMatchObject({ terminalAfterCheckpoint: { outcome: 'timed_out' } });
    expect(first.effects).toEqual([]);
    expect(reduceCheckpointControl(first.state as CheckpointingState, command)).toEqual({
      effects: [],
      state: first.state,
    });
  },
);

test('deferred cancellation omits an absent reason', () => {
  const { reason: _reason, ...withoutReason } = cancel;
  const transition = reduceCheckpointControl(publishing(), withoutReason);
  expect(transition.state).toMatchObject({ terminalAfterCheckpoint: { outcome: 'cancelled' } });
  expect((transition.state as CheckpointingState).terminalAfterCheckpoint).not.toHaveProperty(
    'reason',
  );
});

test('operation timers never own checkpoint control', () => {
  const source = capturing();
  const state: CheckpointingState = {
    ...source,
    timers: [
      ...source.timers,
      { deadlineMs: 4_000, generation: 1, kind: 'operation', timerId: 'operation' },
    ],
  };
  expect(
    reduceCheckpointControl(
      state,
      timer(state, { generation: 1, kind: 'operation', timerId: 'operation' }),
    ),
  ).toEqual({ effects: [], state });
});
