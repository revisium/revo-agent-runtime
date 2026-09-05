import { expect, test } from 'vitest';

import type { SessionCommand } from '../../../../../../../src/execution/session/kernel/command/session-command.js';
import type { SessionEffect } from '../../../../../../../src/execution/session/kernel/effect/session-effect.js';
import { reduceHibernationCapture } from '../../../../../../../src/execution/session/kernel/reducer/checkpoint/hibernate/capture.js';
import { reduceHibernationEvent } from '../../../../../../../src/execution/session/kernel/reducer/checkpoint/hibernate/events.js';
import {
  reduceHibernationCleanup,
  reduceHibernationOutput,
  reduceHibernationRemoval,
} from '../../../../../../../src/execution/session/kernel/reducer/checkpoint/hibernate/lifecycle.js';
import type { HibernatingState } from '../../../../../../../src/execution/session/kernel/reducer/checkpoint/hibernate/state.js';
import { failedHibernation } from '../../../../../../../src/execution/session/kernel/reducer/checkpoint/hibernate/state.js';
import { reduceSession } from '../../../../../../../src/execution/session/kernel/reducer/reduce.js';
import type { SessionTransition } from '../../../../../../../src/execution/session/kernel/reducer/transition.js';
import { permissionInteractionRequest } from '../../../../../../support/session/builders/kernel/interactions.js';
import { streamingSessionState } from '../../../../../../support/session/builders/kernel/running.js';
import { idleSessionState } from '../../../../../../support/session/builders/kernel/session-state.js';

const observed = { observedAt: '2026-03-21T00:00:03.000Z', observedAtMs: 3_000 } as const;
const fault = {
  code: 'revo.agent.internal',
  message: 'failed',
  phase: 'session_checkpointing',
  retryable: false,
} as const;
const hibernate = {
  ...observed,
  call: { callId: 'hibernate-call', epoch: 1, sessionId: 'session_01' },
  resumeTokenId: 'resume-token',
  type: 'session.hibernate',
} as const;

const effectOf = <Type extends SessionEffect['type']>(
  transition: SessionTransition,
  type: Type,
): Extract<SessionEffect, { readonly type: Type }> => {
  const effect = transition.effects.find(
    (candidate): candidate is Extract<SessionEffect, { readonly type: Type }> =>
      candidate.type === type,
  );
  if (effect === undefined) throw new Error(`Missing ${type} effect.`);
  return effect;
};

const capturing = (): HibernatingState => {
  const transition = reduceSession(idleSessionState(), hibernate);
  if (transition.state.status !== 'hibernating') throw new Error('Expected hibernating state.');
  return transition.state;
};

const capturingCorrelation = (state: HibernatingState) => {
  if (state.progress.stage !== 'capturing') throw new Error('Expected capture progress.');
  return state.progress.correlation;
};

const resumeToken = (overrides: Record<string, unknown> = {}) => ({
  cursor: { eventId: 'session_01:1:event:3', sequence: 3, streamId: 'stream_01' },
  eligibility: 'hibernated' as const,
  payload: 'payload',
  pin: idleSessionState().pin,
  resumeTokenId: 'resume-token',
  schemaVersion: 'agent-session-resume-token/v1' as const,
  sessionId: 'session_01',
  sha256: 'sha256',
  ...overrides,
});

const captureCommand = (state: HibernatingState, overrides: Record<string, unknown> = {}) => ({
  ...observed,
  correlation:
    state.progress.stage === 'capturing'
      ? state.progress.correlation
      : { effectId: 'capture', epoch: 1, sessionId: state.sessionId },
  kind: 'hibernate',
  resumeToken: resumeToken(),
  type: 'checkpoint.captured',
  ...overrides,
});

const cleaning = (): HibernatingState => {
  const state = capturing();
  const transition = reduceHibernationCapture(
    state,
    captureCommand(state) as Extract<SessionCommand, { readonly type: `checkpoint.${string}` }>,
  );
  if (transition.state.status !== 'hibernating') throw new Error('Expected hibernating state.');
  return transition.state;
};

const removing = (): HibernatingState => {
  const state = cleaning();
  const transition = reduceHibernationCleanup(state, {
    ...observed,
    correlation: state.progress.stage === 'cleaning_process' ? state.progress.correlation : never(),
    type: 'process.cleanup.confirmed',
  });
  if (transition.state.status !== 'hibernating') throw new Error('Expected hibernating state.');
  return transition.state;
};

const publishingOutput = (): HibernatingState => {
  const state = removing();
  const transition = reduceHibernationRemoval(state, {
    ...observed,
    correlation: state.progress.stage === 'removing_state' ? state.progress.correlation : never(),
    result: { state: 'applied' },
    type: 'persistence.applied',
  });
  if (transition.state.status !== 'hibernating') throw new Error('Expected hibernating state.');
  return transition.state;
};

const publishing = (): HibernatingState => {
  const state = publishingOutput();
  const transition = reduceHibernationOutput(state, {
    ...observed,
    correlation:
      state.progress.stage === 'publishing_output' ? state.progress.correlation : never(),
    output: {
      files: {
        directory: '/output',
        manifest: 'session.json',
        stderr: 'stderr.log',
        stdout: 'stdout.log',
      },
      state: 'published',
    },
    type: 'output.published',
  });
  if (transition.state.status !== 'hibernating') throw new Error('Expected hibernating state.');
  return transition.state;
};

const never = (): never => {
  throw new Error('Unexpected lifecycle stage.');
};

test('rejects hibernation while running, while interacting, and without a cursor', () => {
  expect(
    effectOf(reduceSession(streamingSessionState(), hibernate), 'public.reject'),
  ).toMatchObject({
    fault: { code: 'revo.agent.session_busy', retryable: true },
  });

  const idle = idleSessionState();
  const interacting = {
    ...idle,
    interactions: [
      {
        providerResourceId: idle.providerResourceId,
        request: permissionInteractionRequest,
        scope: { kind: 'opening' as const },
        stage: 'ready' as const,
      },
    ],
  };
  expect(effectOf(reduceSession(interacting, hibernate), 'public.reject').fault.code).toBe(
    'revo.agent.session_busy',
  );
  expect(
    effectOf(reduceSession({ ...idle, events: { pending: [] } }, hibernate), 'public.reject').fault
      .code,
  ).toBe('revo.agent.checkpoint_invalid');
});

test('ignores stale capture outcomes and rejects failed or invalid capture results', () => {
  const state = capturing();
  const correlation = capturingCorrelation(state);
  const wrongStage = { ...state, progress: { ...state.progress, stage: 'closing_provider' } };
  expect(
    reduceHibernationCapture(
      wrongStage as HibernatingState,
      captureCommand(state) as Extract<SessionCommand, { readonly type: `checkpoint.${string}` }>,
    ),
  ).toEqual({ effects: [], state: wrongStage });

  const stale = captureCommand(state, {
    correlation: { ...correlation, effectId: 'stale' },
  }) as Extract<SessionCommand, { readonly type: `checkpoint.${string}` }>;
  expect(reduceHibernationCapture(state, stale)).toEqual({ effects: [], state });

  const failed = reduceHibernationCapture(state, {
    ...observed,
    correlation,
    fault,
    type: 'checkpoint.failed',
  });
  expect(failed.state.status).toBe('idle');
  expect(effectOf(failed, 'public.reject').fault).toBe(fault);

  for (const invalid of [
    { kind: 'checkpoint' },
    { resumeToken: resumeToken({ resumeTokenId: 'wrong' }) },
  ]) {
    const transition = reduceHibernationCapture(
      state,
      captureCommand(state, invalid) as Extract<
        SessionCommand,
        { readonly type: `checkpoint.${string}` }
      >,
    );
    expect(effectOf(transition, 'public.reject').fault.code).toBe('revo.agent.checkpoint_invalid');
  }
});

test('guards cleanup and reports uncertain process ownership', () => {
  const state = cleaning();
  const correlation =
    state.progress.stage === 'cleaning_process' ? state.progress.correlation : never();
  const confirmed = { ...observed, correlation, type: 'process.cleanup.confirmed' } as const;
  expect(reduceHibernationCleanup(capturing(), confirmed)).toEqual({
    effects: [],
    state: capturing(),
  });
  expect(
    reduceHibernationCleanup(state, {
      ...confirmed,
      correlation: { ...correlation, effectId: 'stale' },
    }),
  ).toEqual({ effects: [], state });

  const uncertain = reduceHibernationCleanup(state, {
    ...observed,
    correlation,
    fault,
    type: 'process.cleanup.uncertain',
  });
  expect(uncertain.state).toMatchObject({ status: 'cleanup_uncertain' });
  expect(effectOf(uncertain, 'public.reject').fault).toBe(fault);
});

test('guards durable-state removal and preserves uncertain outcomes', () => {
  const state = removing();
  const correlation =
    state.progress.stage === 'removing_state' ? state.progress.correlation : never();
  const applied = {
    ...observed,
    correlation,
    result: { state: 'applied' },
    type: 'persistence.applied',
  } as const;
  expect(reduceHibernationRemoval(cleaning(), applied)).toEqual({ effects: [], state: cleaning() });
  expect(
    reduceHibernationRemoval(state, {
      ...applied,
      correlation: { ...correlation, effectId: 'stale' },
    }),
  ).toEqual({ effects: [], state });

  const failed = reduceHibernationRemoval(state, {
    ...observed,
    correlation,
    fault,
    type: 'persistence.failed',
  });
  expect(failed.state.status).toBe('cleanup_uncertain');
  expect(effectOf(failed, 'public.reject').fault).toBe(fault);

  const withoutCursor = { ...state, events: { pending: [] as const } };
  expect(
    effectOf(reduceHibernationRemoval(withoutCursor, applied), 'output.publish').publication,
  ).not.toHaveProperty('cursor');
});

test('guards output publication and rejects failed publication', () => {
  const state = publishingOutput();
  const correlation =
    state.progress.stage === 'publishing_output' ? state.progress.correlation : never();
  const failedCommand = {
    ...observed,
    correlation,
    output: {
      error: fault,
      files: {
        directory: '/output',
        manifest: 'session.json',
        stderr: 'stderr.log',
        stdout: 'stdout.log',
      },
      state: 'failed',
    },
    type: 'output.failed',
  } as const;
  expect(reduceHibernationOutput(removing(), failedCommand)).toEqual({
    effects: [],
    state: removing(),
  });
  expect(
    reduceHibernationOutput(state, {
      ...failedCommand,
      correlation: { ...correlation, effectId: 'stale' },
    }),
  ).toEqual({ effects: [], state });
  const failed = reduceHibernationOutput(state, failedCommand);
  expect(failed.state.status).toBe('failed');
  expect(effectOf(failed, 'public.reject').fault).toBe(fault);
});

test('guards hibernation events and rejects failed or conflicting durable appends', () => {
  const state = publishing();
  const inFlight = state.events.inFlight;
  if (inFlight === undefined) throw new Error('Expected an in-flight event.');
  const applied = {
    ...observed,
    correlation: inFlight.correlation,
    result: { state: 'appended' },
    type: 'event.applied',
  } as const;
  expect(reduceHibernationEvent(publishingOutput(), applied)).toEqual({
    effects: [],
    state: publishingOutput(),
  });
  expect(
    reduceHibernationEvent(state, {
      ...applied,
      correlation: { ...inFlight.correlation, effectId: 'stale' },
    }),
  ).toEqual({ effects: [], state });

  const failed = reduceHibernationEvent(state, {
    ...observed,
    correlation: inFlight.correlation,
    fault,
    type: 'event.failed',
  });
  expect(failed.state.status).toBe('failed');
  expect(effectOf(failed, 'public.reject').fault).toBe(fault);

  const conflict = reduceHibernationEvent(state, {
    ...applied,
    result: { state: 'conflict' },
  });
  expect(effectOf(conflict, 'public.reject').fault.code).toBe('revo.agent.event_conflict');

  const withoutCursor = { ...state, events: { ...state.events, cursor: undefined } } as never;
  expect(
    reduceHibernationEvent(withoutCursor, {
      ...observed,
      correlation: inFlight.correlation,
      fault,
      type: 'event.failed',
    }).state,
  ).toMatchObject({ status: 'failed' });

  const unrelated = {
    eventId: 'turn-started',
    observedAt: observed.observedAt,
    prompt: 'Continue',
    schemaVersion: 'agent-session-event/v1' as const,
    sequence: state.nextEventSequence,
    sessionId: state.sessionId,
    streamId: state.streamId,
    turnId: 'turn',
    type: 'turn.started' as const,
  };
  const withUnrelated = {
    ...state,
    events: { ...state.events, inFlight: { correlation: inFlight.correlation, event: unrelated } },
  };
  expect(reduceHibernationEvent(withUnrelated, applied).state.events.cursor).toMatchObject({
    eventId: 'turn-started',
  });
});

test('failed hibernation omits output when publication never started', () => {
  expect(failedHibernation(capturing(), fault, observed.observedAt)).not.toHaveProperty('output');
});
