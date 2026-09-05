import { expect, test } from 'vitest';

import type { SessionEffect } from '../../../../../../../src/execution/session/kernel/effect/session-effect.js';
import { createOpeningSessionState } from '../../../../../../../src/execution/session/kernel/reducer/opening.js';
import { reduceOpeningEvent } from '../../../../../../../src/execution/session/kernel/reducer/opening/events.js';
import {
  beginOpeningProcessCleanup,
  reduceOpeningCleanup,
} from '../../../../../../../src/execution/session/kernel/reducer/opening/failure.js';
import {
  reducePersistenceOutcome,
  reducePreparation,
  reduceProcessOutcome,
  reduceProviderOpenOutcome,
} from '../../../../../../../src/execution/session/kernel/reducer/opening/stages.js';
import { reduceSession } from '../../../../../../../src/execution/session/kernel/reducer/reduce.js';
import type { SessionTransition } from '../../../../../../../src/execution/session/kernel/reducer/transition.js';
import {
  outcomeTime,
  outcomeTimeMs,
  sessionCapabilities,
  sessionOpeningCommand,
  sessionProcess,
} from '../../../../../../support/session/builders/kernel/opening.js';

const fault = {
  code: 'revo.agent.internal',
  message: 'failed',
  phase: 'session_opening',
  retryable: false,
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
const base = (effect: SessionEffect) => ({
  correlation: effect.correlation,
  observedAt: outcomeTime,
  observedAtMs: outcomeTimeMs,
});

const preparing = () => {
  const command = sessionOpeningCommand();
  const started = reduceSession(createOpeningSessionState(command), command);
  const event = effectOf(started, 'event.append');
  return reduceSession(started.state, {
    ...base(event),
    result: { state: 'appended' },
    type: 'event.timed_out_then_applied',
  });
};
const startingProcess = () => {
  const started = preparing();
  const effect = effectOf(started, 'opening.prepare');
  return reduceSession(started.state, {
    ...base(effect),
    preparationId: 'preparation_01',
    type: 'opening.preparation.succeeded',
  });
};
const savingProcess = () => {
  const started = startingProcess();
  const effect = effectOf(started, 'process.start');
  return reduceSession(started.state, {
    ...base(effect),
    process: sessionProcess,
    processResourceId: 'process_01',
    type: 'process.started',
  });
};
const openingProvider = () => {
  const started = savingProcess();
  const effect = effectOf(started, 'persistence.save');
  return reduceSession(started.state, {
    ...base(effect),
    result: { state: 'applied' },
    type: 'persistence.applied',
  });
};

test.each([
  'opening.preparation.rejected',
  'opening.preparation.failed',
  'opening.preparation.timed_out',
] as const)('%s fails before process ownership', (type) => {
  const started = preparing();
  const transition = reduceSession(started.state, {
    ...base(effectOf(started, 'opening.prepare')),
    fault,
    type,
  });
  expect(transition.state.status).toBe('failed');
});

test.each(['process.failed', 'process.timed_out'] as const)('%s fails before ownership', (type) => {
  const started = startingProcess();
  const transition = reduceSession(started.state, {
    ...base(effectOf(started, 'process.start')),
    fault,
    type,
  });
  expect(transition.state.status).toBe('failed');
});

test('active-state ownership refusal cleans the newly owned process', () => {
  const started = savingProcess();
  const transition = reduceSession(started.state, {
    ...base(effectOf(started, 'persistence.save')),
    result: { state: 'not_owner' },
    type: 'persistence.applied',
  });
  expect(transition.state).toMatchObject({ progress: { stage: 'cleaning_process' } });
});

test('late applied active-state save resumes provider opening', () => {
  const started = savingProcess();
  const transition = reduceSession(started.state, {
    ...base(effectOf(started, 'persistence.save')),
    result: { state: 'applied' },
    type: 'persistence.late_applied',
  });
  expect(effectOf(transition, 'provider.open')).toBeDefined();
});

test.each(['provider.open_failed', 'provider.open_timed_out'] as const)(
  '%s cleans the process and saved state',
  (type) => {
    const started = openingProvider();
    const transition = reduceSession(started.state, {
      ...base(effectOf(started, 'provider.open')),
      fault,
      type,
    });
    expect(transition.state).toMatchObject({ progress: { afterCleanup: 'remove_state' } });
  },
);

test('event conflicts and stale event outcomes fail safely', () => {
  const command = sessionOpeningCommand();
  const started = reduceSession(createOpeningSessionState(command), command);
  const event = effectOf(started, 'event.append');
  const stale = reduceSession(started.state, {
    correlation: { ...event.correlation, effectId: 'stale' },
    fault,
    observedAt: outcomeTime,
    observedAtMs: outcomeTimeMs,
    type: 'event.timed_out_then_failed',
  });
  expect(stale).toEqual({ effects: [], state: started.state });
  const staleApplied = reduceSession(started.state, {
    correlation: { ...event.correlation, effectId: 'stale' },
    observedAt: outcomeTime,
    observedAtMs: outcomeTimeMs,
    result: { state: 'appended' },
    type: 'event.applied',
  });
  expect(staleApplied).toEqual({ effects: [], state: started.state });
  const conflict = reduceSession(started.state, {
    ...base(event),
    result: { state: 'conflict' },
    type: 'event.applied',
  });
  expect(conflict.state).toMatchObject({
    error: { code: 'revo.agent.event_conflict' },
    status: 'failed',
  });
});

test('acknowledges a queued non-opening event without advancing the opening stage', () => {
  const command = sessionOpeningCommand();
  const started = reduceSession(createOpeningSessionState(command), command);
  const append = effectOf(started, 'event.append');
  const event = {
    eventId: 'turn-started',
    observedAt: outcomeTime,
    prompt: 'Continue',
    schemaVersion: 'agent-session-event/v1' as const,
    sequence: started.state.nextEventSequence,
    sessionId: started.state.sessionId,
    streamId: started.state.streamId,
    turnId: 'turn_01',
    type: 'turn.started' as const,
  };
  const state = {
    ...started.state,
    events: { ...started.state.events, inFlight: { correlation: append.correlation, event } },
  };
  const transition = reduceOpeningEvent(state as Parameters<typeof reduceOpeningEvent>[0], {
    ...base(append),
    result: { state: 'appended' },
    type: 'event.applied',
  });
  expect(transition.state).toMatchObject({
    events: { cursor: { eventId: 'turn-started' } },
    progress: { stage: 'publishing_accepted' },
  });
});

test.each(['persistence.failed', 'persistence.late_failed', 'persistence.unknown'] as const)(
  '%s while removing saved opening state preserves uncertainty',
  (type) => {
    const opened = openingProvider();
    let transition = reduceSession(opened.state, {
      ...base(effectOf(opened, 'provider.open')),
      fault,
      type: 'provider.open_failed',
    });
    transition = reduceSession(transition.state, {
      ...base(effectOf(transition, 'process.cleanup')),
      type: 'process.cleanup.confirmed',
    });
    transition = reduceSession(transition.state, {
      ...base(effectOf(transition, 'persistence.remove')),
      fault,
      type,
    });
    expect(transition.state.status).toBe('cleanup_uncertain');
  },
);

test('successful provider open still emits the negotiated capabilities', () => {
  const started = openingProvider();
  const transition = reduceSession(started.state, {
    ...base(effectOf(started, 'provider.open')),
    capabilities: sessionCapabilities,
    providerResourceId: 'provider_01',
    type: 'provider.opened',
  });
  expect(effectOf(transition, 'event.append').event).toMatchObject({
    capabilities: sessionCapabilities,
  });
});

test('opening event acknowledgement respects the current stage and inactivity conditions', () => {
  const command = sessionOpeningCommand();
  const started = reduceSession(createOpeningSessionState(command), command);
  const accepted = effectOf(started, 'event.append');
  const preparingState = {
    ...started.state,
    progress: {
      correlation: accepted.correlation,
      opening: command.opening,
      stage: 'preparing' as const,
    },
  };
  expect(
    reduceOpeningEvent(preparingState as Parameters<typeof reduceOpeningEvent>[0], {
      ...base(accepted),
      result: { state: 'appended' },
      type: 'event.applied',
    }).state as Parameters<typeof reduceOpeningEvent>[0],
  ).toMatchObject({ progress: preparingState.progress });

  const provider = openingProvider();
  const opened = reduceSession(provider.state, {
    ...base(effectOf(provider, 'provider.open')),
    capabilities: sessionCapabilities,
    providerResourceId: 'provider_01',
    type: 'provider.opened',
  });
  const appended = effectOf(opened, 'event.append');
  const openedAtWrongStage = { ...opened.state, progress: preparingState.progress };
  expect(
    reduceOpeningEvent(openedAtWrongStage as Parameters<typeof reduceOpeningEvent>[0], {
      ...base(appended),
      result: { state: 'appended' },
      type: 'event.applied',
    }).state,
  ).toMatchObject({ progress: preparingState.progress });
  const withoutOpeningTimer = {
    ...opened.state,
    timers: opened.state.timers.filter(({ kind }) => kind !== 'opening'),
  };
  expect(
    reduceOpeningEvent(withoutOpeningTimer as Parameters<typeof reduceOpeningEvent>[0], {
      ...base(appended),
      result: { state: 'appended' },
      type: 'event.applied',
    }).effects.map(({ type }) => type),
  ).toEqual(['timer.schedule', 'public.resolve']);

  const interaction = {
    providerResourceId: 'provider_01',
    request: {
      action: { kind: 'execute' as const },
      kind: 'permission' as const,
      options: [],
      requestId: 'request_01',
    },
    scope: { kind: 'opening' as const },
    stage: 'ready' as const,
  };
  const withInteraction = { ...opened.state, interactions: [interaction] };
  expect(
    reduceOpeningEvent(withInteraction as Parameters<typeof reduceOpeningEvent>[0], {
      ...base(appended),
      result: { state: 'appended' },
      type: 'event.applied',
    }).effects.map(({ type }) => type),
  ).toEqual(['timer.cancel', 'public.resolve']);
});

test('an opened-event failure cleans both provider process and durable state', () => {
  const provider = openingProvider();
  const opened = reduceSession(provider.state, {
    ...base(effectOf(provider, 'provider.open')),
    capabilities: sessionCapabilities,
    providerResourceId: 'provider_01',
    type: 'provider.opened',
  });
  const transition = reduceOpeningEvent(opened.state as Parameters<typeof reduceOpeningEvent>[0], {
    ...base(effectOf(opened, 'event.append')),
    fault,
    type: 'event.failed',
  });
  expect(transition.state).toMatchObject({
    progress: { afterCleanup: 'remove_state', stage: 'cleaning_process' },
  });
});

test.each(['event.failed', 'event.unknown'] as const)(
  'late %s cannot finalize an opening whose process cleanup is pending',
  (type) => {
    const provider = openingProvider();
    const opened = reduceSession(provider.state, {
      ...base(effectOf(provider, 'provider.open')),
      capabilities: sessionCapabilities,
      providerResourceId: 'provider_01',
      type: 'provider.opened',
    });
    const cancelled = reduceSession(opened.state, {
      call: { callId: 'cancel', epoch: 1, sessionId: 'session_01' },
      observedAt: outcomeTime,
      observedAtMs: outcomeTimeMs,
      type: 'session.cancel',
    });

    const late = reduceSession(cancelled.state, {
      ...base(effectOf(opened, 'event.append')),
      fault,
      type,
    });

    expect(late).toEqual({ effects: [], state: cancelled.state });
  },
);

test('opening state preserves optional metadata', () => {
  const command = sessionOpeningCommand();
  const withMetadata = {
    ...command,
    opening: { ...command.opening, metadata: { source: 'test' } },
  };
  expect(
    createOpeningSessionState(withMetadata as Parameters<typeof createOpeningSessionState>[0])
      .metadata,
  ).toEqual({ source: 'test' });
});

test('stage reducers ignore outcomes owned by another opening stage', () => {
  const prepared = preparing();
  const preparation = effectOf(prepared, 'opening.prepare');
  const initial = createOpeningSessionState(sessionOpeningCommand());
  expect(
    reducePreparation(initial, {
      ...base(preparation),
      preparationId: 'preparation_01',
      type: 'opening.preparation.succeeded',
    }),
  ).toEqual({ effects: [], state: initial });

  const process = startingProcess();
  const processStart = effectOf(process, 'process.start');
  expect(
    reduceProcessOutcome(prepared.state as typeof initial, {
      ...base(processStart),
      process: sessionProcess,
      processResourceId: 'process_01',
      type: 'process.started',
    }),
  ).toEqual({ effects: [], state: prepared.state });

  const saving = savingProcess();
  const save = effectOf(saving, 'persistence.save');
  expect(
    reducePersistenceOutcome(process.state as typeof initial, {
      ...base(save),
      result: { state: 'applied' },
      type: 'persistence.applied',
    }),
  ).toEqual({ effects: [], state: process.state });

  const provider = openingProvider();
  const open = effectOf(provider, 'provider.open');
  expect(
    reduceProviderOpenOutcome(saving.state as typeof initial, {
      ...base(open),
      capabilities: sessionCapabilities,
      providerResourceId: 'provider_01',
      type: 'provider.opened',
    }),
  ).toEqual({ effects: [], state: saving.state });
});

test('opening cleanup ignores stale and stage-incompatible outcomes', () => {
  const command = sessionOpeningCommand();
  const initial = createOpeningSessionState(command);
  const cleanupCommand = {
    correlation: { effectId: 'cleanup', epoch: 1, sessionId: initial.sessionId },
    observedAt: outcomeTime,
    observedAtMs: outcomeTimeMs,
    type: 'process.cleanup.confirmed',
  } as const;
  expect(reduceOpeningCleanup(initial, cleanupCommand)).toEqual({ effects: [], state: initial });
  expect(beginOpeningProcessCleanup(initial, fault, 'fail').state.status).toBe('failed');

  const prepared = preparing();
  const preparation = effectOf(prepared, 'opening.prepare');
  expect(
    reduceOpeningCleanup(prepared.state as typeof initial, {
      ...base(preparation),
      type: 'process.cleanup.confirmed',
    }),
  ).toEqual({ effects: [], state: prepared.state });

  const opened = openingProvider();
  let cleaning = reduceSession(opened.state, {
    ...base(effectOf(opened, 'provider.open')),
    fault,
    type: 'provider.open_failed',
  });
  const cleanup = effectOf(cleaning, 'process.cleanup');
  expect(
    reduceOpeningCleanup(cleaning.state as typeof initial, {
      ...base(cleanup),
      correlation: { ...cleanup.correlation, effectId: 'stale' },
      type: 'process.cleanup.confirmed',
    }),
  ).toEqual({ effects: [], state: cleaning.state });
  expect(
    reduceOpeningCleanup(cleaning.state as typeof initial, {
      ...base(cleanup),
      result: { state: 'applied' },
      type: 'persistence.applied',
    }),
  ).toEqual({ effects: [], state: cleaning.state });

  cleaning = reduceSession(cleaning.state, {
    ...base(cleanup),
    type: 'process.cleanup.confirmed',
  });
  const removal = effectOf(cleaning, 'persistence.remove');
  expect(
    reduceOpeningCleanup(cleaning.state as typeof initial, {
      ...base(removal),
      type: 'process.cleanup.confirmed',
    }),
  ).toEqual({ effects: [], state: cleaning.state });
});
