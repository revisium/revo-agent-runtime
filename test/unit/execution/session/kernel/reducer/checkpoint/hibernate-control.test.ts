import { expect, test } from 'vitest';

import type { AgentSessionOutputPublication } from '../../../../../../../src/contracts/session/lifecycle/result.js';
import type { TimerCommand } from '../../../../../../../src/execution/session/kernel/command/timer.js';
import { reduceHibernationControl } from '../../../../../../../src/execution/session/kernel/reducer/checkpoint/hibernate/control.js';
import type { HibernatingState } from '../../../../../../../src/execution/session/kernel/reducer/checkpoint/hibernate/state.js';
import { reduceSession } from '../../../../../../../src/execution/session/kernel/reducer/reduce.js';
import { idleSessionState } from '../../../../../../support/session/builders/kernel/session-state.js';

const observed = { observedAt: '2026-03-21T00:00:03.000Z', observedAtMs: 3_000 } as const;
const hibernate = {
  ...observed,
  call: { callId: 'hibernate-call', epoch: 1, sessionId: 'session_01' },
  resumeTokenId: 'resume-token',
  type: 'session.hibernate',
} as const;
const cancel = {
  ...observed,
  call: { callId: 'cancel-call', epoch: 1, sessionId: 'session_01' },
  reason: 'stop',
  type: 'session.cancel',
} as const;
const resumeToken = {
  cursor: { eventId: 'event', sequence: 3, streamId: 'stream_01' },
  eligibility: 'hibernated',
  payload: 'payload',
  pin: idleSessionState().pin,
  resumeTokenId: 'resume-token',
  schemaVersion: 'agent-session-resume-token/v1',
  sessionId: 'session_01',
  sha256: 'sha256',
} as const;
const output: AgentSessionOutputPublication = {
  files: {
    directory: '/output',
    manifest: 'session.json',
    stderr: 'stderr.log',
    stdout: 'stdout.log',
  },
  state: 'published',
};

const capturing = (): HibernatingState => {
  const transition = reduceSession(idleSessionState(), hibernate);
  if (transition.state.status !== 'hibernating') throw new Error('expected hibernating state');
  return transition.state;
};

const stateAt = (
  stage:
    | 'closing_provider'
    | 'cleaning_process'
    | 'removing_state'
    | 'publishing_output'
    | 'publishing',
): HibernatingState => {
  const state = capturing();
  const correlation = { effectId: `${stage}-effect`, epoch: 1, sessionId: 'session_01' };
  if (stage === 'publishing')
    return { ...state, progress: { finishedAt: observed.observedAt, output, resumeToken, stage } };
  if (stage === 'removing_state' || stage === 'publishing_output')
    return {
      ...state,
      progress: { correlation, finishedAt: observed.observedAt, resumeToken, stage },
    };
  return { ...state, progress: { correlation, resumeToken, stage } };
};

const timer = (state: HibernatingState, overrides: Partial<TimerCommand> = {}): TimerCommand => {
  const wall = state.timers.find(({ kind }) => kind === 'wall_clock')!;
  return {
    correlation: { effectId: 'timer-callback', epoch: 1, sessionId: state.sessionId },
    firedAt: observed.observedAt,
    firedAtMs: observed.observedAtMs,
    generation: wall.generation,
    kind: wall.kind,
    timerId: wall.timerId,
    type: 'timer.fired',
    ...overrides,
  };
};

test('graceful close cannot interrupt hibernation', () => {
  const transition = reduceHibernationControl(capturing(), {
    ...observed,
    call: { callId: 'close-call', epoch: 1, sessionId: 'session_01' },
    type: 'session.close',
  });
  expect(transition.state.status).toBe('hibernating');
  expect(transition.effects.at(-1)).toMatchObject({
    fault: { code: 'revo.agent.session_busy' },
    type: 'public.reject',
  });
});

test.each([{ timerId: 'wrong' }, { generation: 99 }, { kind: 'idle' as const }] as const)(
  'ignores a timer that does not own hibernation: %#',
  (overrides) => {
    const state = capturing();
    expect(reduceHibernationControl(state, timer(state, overrides))).toEqual({
      effects: [],
      state,
    });
  },
);

test('ignores matching timers after continuation capture', () => {
  const state = stateAt('closing_provider');
  expect(reduceHibernationControl(state, timer(state))).toEqual({ effects: [], state });
});

test('cancellation during capture terminalizes the session and rejects hibernation', () => {
  const transition = reduceHibernationControl(capturing(), cancel);
  expect(transition.state).toMatchObject({
    intent: { outcome: 'cancelled' },
    status: 'cancelling',
  });
  expect(transition.effects.map(({ type }) => type)).toEqual([
    'timer.cancel',
    'provider.close',
    'process.cleanup',
    'public.resolve',
    'public.reject',
  ]);
});

test('wall-clock timeout during capture preserves the timeout fault for hibernation rejection', () => {
  const state = capturing();
  const transition = reduceHibernationControl(state, timer(state));
  expect(transition.state).toMatchObject({
    intent: { outcome: 'timed_out' },
    status: 'cancelling',
  });
  expect(transition.effects.at(-1)).toMatchObject({
    fault: { code: 'revo.agent.timeout' },
    type: 'public.reject',
  });
});

test.each(['publishing_output', 'publishing'] as const)(
  'reports cancellation as already terminal during %s',
  (stage) => {
    const transition = reduceHibernationControl(stateAt(stage), cancel);
    expect(transition.state.status).toBe('hibernating');
    expect(transition.effects).toEqual([
      expect.objectContaining({
        resolution: { kind: 'cancel_session', result: { state: 'already_terminal' } },
        type: 'public.resolve',
      }),
    ]);
  },
);

test.each(['closing_provider', 'cleaning_process', 'removing_state'] as const)(
  'cancellation takes ownership during %s',
  (stage) => {
    const { reason: _reason, ...cancelWithoutReason } = cancel;
    const command = stage === 'closing_provider' ? cancelWithoutReason : cancel;
    const transition = reduceHibernationControl(stateAt(stage), command);
    expect(transition.state).toMatchObject({
      intent: { outcome: 'cancelled' },
      progress: { stage: stage === 'removing_state' ? 'removing_state' : 'cleaning_process' },
      status: 'cancelling',
    });
    expect(transition.effects.slice(-2).map(({ type }) => type)).toEqual([
      'public.reject',
      'public.resolve',
    ]);
  },
);

test('operation timers never control hibernation even when registered', () => {
  const source = capturing();
  const operation = {
    deadlineMs: 4_000,
    generation: 1,
    kind: 'operation' as const,
    timerId: 'operation-timer',
  };
  const state: HibernatingState = { ...source, timers: [...source.timers, operation] };
  expect(
    reduceHibernationControl(
      state,
      timer(state, { generation: 1, kind: 'operation', timerId: 'operation-timer' }),
    ),
  ).toEqual({ effects: [], state });
});
