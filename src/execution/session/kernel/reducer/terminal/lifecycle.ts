import type { SessionClosedEvent } from '../../../../../contracts/session/events/event.js';
import type { EffectOutcomeCommand } from '../../command/effect.js';
import {
  appendEffect,
  nextEffectCorrelation,
  nextSessionEventId,
  queueSessionEvent,
  type SessionTransition,
  unchangedTransition,
} from '../transition.js';
import type { TerminalizingSession } from './state.js';

const matchesProgress = (state: TerminalizingSession, effectId: string): boolean =>
  'correlation' in state.progress && state.progress.correlation.effectId === effectId;

const closedEvent = (
  state: TerminalizingSession,
  command: EffectOutcomeCommand,
): SessionClosedEvent => {
  const base = {
    eventId: nextSessionEventId(state),
    observedAt: command.observedAt,
    schemaVersion: 'agent-session-event/v1' as const,
    sequence: state.nextEventSequence,
    sessionId: state.sessionId,
    streamId: state.streamId,
    type: 'session.closed' as const,
  };
  if (state.intent.outcome === 'failed')
    return { ...base, error: state.intent.error, outcome: 'failed' };
  if (state.intent.outcome === 'timed_out')
    return { ...base, error: state.intent.error, outcome: state.intent.timeout };
  return { ...base, outcome: state.intent.outcome };
};

export const reduceCleanupOutcome = (
  state: TerminalizingSession,
  command: Extract<
    EffectOutcomeCommand,
    { readonly type: 'process.cleanup.confirmed' | 'process.cleanup.uncertain' }
  >,
): SessionTransition => {
  if (
    state.progress.stage !== 'cleaning_process' ||
    !matchesProgress(state, command.correlation.effectId)
  )
    return unchangedTransition(state);
  if (command.type === 'process.cleanup.uncertain') {
    const {
      callIds: _calls,
      intent: _intent,
      progress: _progress,
      status: _status,
      ...base
    } = state;
    return {
      effects: [],
      state: {
        ...base,
        error: command.fault,
        process: state.process,
        processResourceId: state.processResourceId,
        status: 'cleanup_uncertain',
      },
    };
  }
  const correlation = nextEffectCorrelation(state);
  return appendEffect(
    {
      effects: [],
      state: { ...state, progress: { correlation, stage: 'removing_state' } },
    },
    {
      correlation,
      incarnationId: state.incarnationId,
      timeoutMs: state.limits.operationTimeoutMs,
      type: 'persistence.remove',
    },
  );
};

export const reduceRemovalOutcome = (
  state: TerminalizingSession,
  command: Extract<
    EffectOutcomeCommand,
    { readonly type: 'persistence.applied' | 'persistence.failed' | 'persistence.unknown' }
  >,
): SessionTransition => {
  if (
    state.progress.stage !== 'removing_state' ||
    !matchesProgress(state, command.correlation.effectId)
  )
    return unchangedTransition(state);
  if (command.type !== 'persistence.applied') {
    const {
      callIds: _calls,
      intent: _intent,
      progress: _progress,
      status: _status,
      ...base
    } = state;
    return { effects: [], state: { ...base, error: command.fault, status: 'cleanup_uncertain' } };
  }
  return queueSessionEvent(
    { ...state, progress: { stage: 'publishing_event' } },
    closedEvent(state, command),
  );
};
