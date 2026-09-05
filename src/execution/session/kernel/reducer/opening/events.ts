import type {
  SessionAcceptedEvent,
  SessionOpenedEvent,
} from '../../../../../contracts/session/events/event.js';
import type { AgentSessionEventAppendPrecondition } from '../../../../../contracts/session/events/sink.js';
import type { SessionCommand } from '../../command/session-command.js';
import {
  acknowledgeSessionEvent,
  appendEffect,
  nextEffectCorrelation,
  nextSessionEventId,
  queueSessionEvent,
  type SessionTransition,
  unchangedTransition,
} from '../transition.js';
import {
  beginOpeningProcessCleanup,
  failOpeningBeforeProcess,
  openingEventConflictFault,
} from './failure.js';
import { openingCleanupInProgress, type OpeningCommand, type OpeningState } from './state.js';
import { cancelOpeningTimer, scheduleOpeningTimer } from './timing.js';

const acceptedEvent = (state: OpeningState, command: OpeningCommand): SessionAcceptedEvent => {
  const base = {
    eventId: nextSessionEventId(state),
    observedAt: command.observedAt,
    pin: state.pin,
    schemaVersion: 'agent-session-event/v1',
    sequence: state.nextEventSequence,
    sessionId: state.sessionId,
    streamId: state.streamId,
    type: 'session.accepted',
  } as const;
  const request = command.opening.request;
  return request.kind === 'fresh'
    ? { ...base, resumed: false }
    : {
        ...base,
        resumeTokenId: request.request.token.resumeTokenId,
        resumeTokenSha256: request.request.token.sha256,
        resumed: true,
      };
};

const acceptedPrecondition = (command: OpeningCommand): AgentSessionEventAppendPrecondition => {
  const request = command.opening.request;
  if (request.kind === 'fresh') return { kind: 'empty' };
  const token = request.request.token;
  return {
    cursor: token.cursor,
    kind: 'hibernation_token',
    resumeTokenId: token.resumeTokenId,
    resumeTokenSha256: token.sha256,
  };
};

export const startOpening = (state: OpeningState, command: OpeningCommand): SessionTransition => {
  if (
    state.progress.stage !== 'publishing_accepted' ||
    (command.type === 'session.open') !== (state.progress.opening.request.kind === 'fresh')
  )
    return unchangedTransition(state);
  let transition = queueSessionEvent(
    state,
    acceptedEvent(state, command),
    acceptedPrecondition(command),
    command.opening.environment?.secrets,
  );
  transition = scheduleOpeningTimer(transition, {
    deadlineMs: state.acceptedAtMs + state.limits.wallClockTimeoutMs,
    generation: 1,
    kind: 'wall_clock',
    timerId: `${state.sessionId}:${state.epoch}:wall`,
  });
  return scheduleOpeningTimer(transition, {
    deadlineMs: state.acceptedAtMs + state.limits.openingTimeoutMs,
    generation: 1,
    kind: 'opening',
    timerId: `${state.sessionId}:${state.epoch}:opening`,
  });
};

const prepareAfterAccepted = (
  state: OpeningState,
  transition: SessionTransition<OpeningState>,
): SessionTransition => {
  if (state.progress.stage !== 'publishing_accepted') return transition;
  const opening = transition.state;
  const correlation = nextEffectCorrelation(opening);
  return appendEffect(
    {
      effects: transition.effects,
      state: {
        ...opening,
        progress: { correlation, opening: state.progress.opening, stage: 'preparing' },
      },
    },
    {
      correlation,
      opening: state.progress.opening,
      timeoutMs: state.limits.operationTimeoutMs,
      type: 'opening.prepare',
    },
  );
};

const finishOpenedEvent = (
  state: OpeningState,
  transition: SessionTransition<OpeningState>,
  event: SessionOpenedEvent,
): SessionTransition => {
  if (state.progress.stage !== 'publishing_opened') return transition;
  const progress = state.progress;
  const { callId, progress: _progress, ...base } = transition.state;
  const openingTimer = base.timers.find(({ kind }) => kind === 'opening');
  let result: SessionTransition = {
    effects: transition.effects,
    state: {
      ...base,
      capabilities: progress.capabilities,
      openedAt: event.observedAt,
      process: progress.process,
      processResourceId: progress.processResourceId,
      providerResourceId: progress.providerResourceId,
      status: 'idle',
      timers: base.timers.filter(({ kind }) => kind !== 'opening'),
    },
  };
  if (openingTimer !== undefined) result = cancelOpeningTimer(result, openingTimer);
  if (result.state.interactions.length === 0)
    result = scheduleOpeningTimer(result, {
      deadlineMs: progress.openedAtMs + state.limits.idleTimeoutMs,
      generation: 1,
      kind: 'idle',
      timerId: `${state.sessionId}:${state.epoch}:idle`,
    });
  const correlation = nextEffectCorrelation(result.state);
  return appendEffect(result, {
    callId,
    correlation,
    resolution: { kind: 'session_ready' },
    type: 'public.resolve',
  });
};

export const reduceOpeningEvent = (
  state: OpeningState,
  command: Extract<
    SessionCommand,
    {
      readonly type:
        | 'event.applied'
        | 'event.timed_out_then_applied'
        | 'event.failed'
        | 'event.timed_out_then_failed'
        | 'event.unknown';
    }
  >,
): SessionTransition => {
  if (openingCleanupInProgress(state)) return unchangedTransition(state);
  const failEvent = (fault: import('../../../../../contracts/manager/core.js').AgentFault) =>
    state.progress.stage === 'publishing_opened'
      ? beginOpeningProcessCleanup(state, fault, 'remove_state')
      : failOpeningBeforeProcess(state, fault, command.observedAt);
  if (
    command.type === 'event.failed' ||
    command.type === 'event.timed_out_then_failed' ||
    command.type === 'event.unknown'
  )
    return state.events.inFlight?.correlation.effectId === command.correlation.effectId
      ? failEvent(command.fault)
      : unchangedTransition(state);
  if (command.result.state === 'conflict') return failEvent(openingEventConflictFault());
  const acknowledged = acknowledgeSessionEvent(state, command.correlation);
  if (acknowledged === undefined) return unchangedTransition(state);
  if (acknowledged.event.type === 'session.accepted')
    return prepareAfterAccepted(state, acknowledged.transition);
  if (acknowledged.event.type === 'session.opened')
    return finishOpenedEvent(state, acknowledged.transition, acknowledged.event);
  return acknowledged.transition;
};
