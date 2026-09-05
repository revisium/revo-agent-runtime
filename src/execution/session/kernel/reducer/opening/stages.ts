import type { SessionOpenedEvent } from '../../../../../contracts/session/events/event.js';
import type { SessionCommand } from '../../command/session-command.js';
import { isPersistenceApplied, type PersistenceOutcome } from '../persistence/outcome.js';
import {
  appendEffect,
  nextEffectCorrelation,
  nextSessionEventId,
  queueSessionEvent,
  type SessionTransition,
  unchangedTransition,
} from '../transition.js';
import { beginOpeningProcessCleanup, failOpeningBeforeProcess } from './failure.js';
import type { OpeningState } from './state.js';

const matchingProgress = (state: OpeningState, effectId: string): boolean =>
  'correlation' in state.progress && state.progress.correlation.effectId === effectId;

export const reducePreparation = (
  state: OpeningState,
  command: Extract<SessionCommand, { readonly type: `opening.preparation.${string}` }>,
): SessionTransition => {
  if (
    state.progress.stage !== 'preparing' ||
    !matchingProgress(state, command.correlation.effectId)
  )
    return unchangedTransition(state);
  if (command.type !== 'opening.preparation.succeeded')
    return failOpeningBeforeProcess(state, command.fault, command.observedAt);
  const correlation = nextEffectCorrelation(state);
  return appendEffect(
    {
      effects: [],
      state: {
        ...state,
        progress: {
          correlation,
          preparationId: command.preparationId,
          resumed: state.progress.opening.request.kind === 'resume',
          stage: 'starting_process',
        },
      },
    },
    {
      correlation,
      preparationId: command.preparationId,
      timeoutMs: state.limits.openingTimeoutMs,
      type: 'process.start',
    },
  );
};

export const reduceProcessOutcome = (
  state: OpeningState,
  command: Extract<
    SessionCommand,
    { readonly type: 'process.started' | 'process.failed' | 'process.timed_out' }
  >,
): SessionTransition => {
  if (
    state.progress.stage !== 'starting_process' ||
    !matchingProgress(state, command.correlation.effectId)
  )
    return unchangedTransition(state);
  if (command.type !== 'process.started')
    return failOpeningBeforeProcess(state, command.fault, command.observedAt);
  const correlation = nextEffectCorrelation(state);
  return appendEffect(
    {
      effects: [],
      state: {
        ...state,
        progress: {
          correlation,
          preparationId: state.progress.preparationId,
          process: command.process,
          processResourceId: command.processResourceId,
          resumed: state.progress.resumed,
          stage: 'saving_process',
        },
      },
    },
    {
      correlation,
      snapshot: {
        acceptedAt: state.acceptedAt,
        incarnationId: state.incarnationId,
        pin: state.pin,
        process: command.process,
        sessionId: state.sessionId,
        state: 'opening',
      },
      timeoutMs: state.limits.operationTimeoutMs,
      type: 'persistence.save',
    },
  );
};

export const reducePersistenceOutcome = (
  state: OpeningState,
  command: PersistenceOutcome,
): SessionTransition => {
  if (
    state.progress.stage !== 'saving_process' ||
    !matchingProgress(state, command.correlation.effectId)
  )
    return unchangedTransition(state);
  if (command.type === 'persistence.failed' || command.type === 'persistence.late_failed')
    return beginOpeningProcessCleanup(state, command.fault, 'fail');
  if (command.type === 'persistence.unknown')
    return beginOpeningProcessCleanup(state, command.fault, 'uncertain');
  if (!isPersistenceApplied(command)) return unchangedTransition(state);
  if (command.result.state !== 'applied')
    return beginOpeningProcessCleanup(
      state,
      {
        code: 'revo.agent.active_state_failed',
        message: 'The active session state was not owned by this incarnation.',
        phase: 'session_opening',
        retryable: false,
      },
      'fail',
    );
  const correlation = nextEffectCorrelation(state);
  return appendEffect(
    {
      effects: [],
      state: {
        ...state,
        progress: { ...state.progress, correlation, stage: 'opening_provider' },
      },
    },
    {
      correlation,
      preparationId: state.progress.preparationId,
      processResourceId: state.progress.processResourceId,
      timeoutMs: state.limits.openingTimeoutMs,
      type: 'provider.open',
    },
  );
};

export const reduceProviderOpenOutcome = (
  state: OpeningState,
  command: Extract<
    SessionCommand,
    { readonly type: 'provider.opened' | 'provider.open_failed' | 'provider.open_timed_out' }
  >,
): SessionTransition => {
  if (
    state.progress.stage !== 'opening_provider' ||
    !matchingProgress(state, command.correlation.effectId)
  )
    return unchangedTransition(state);
  if (command.type !== 'provider.opened')
    return beginOpeningProcessCleanup(state, command.fault, 'remove_state');
  const event: SessionOpenedEvent = {
    capabilities: command.capabilities,
    eventId: nextSessionEventId(state),
    observedAt: command.observedAt,
    pin: state.pin,
    resumed: state.progress.resumed,
    schemaVersion: 'agent-session-event/v1',
    sequence: state.nextEventSequence,
    sessionId: state.sessionId,
    streamId: state.streamId,
    type: 'session.opened',
  };
  return queueSessionEvent(
    {
      ...state,
      progress: {
        capabilities: command.capabilities,
        openedAtMs: command.observedAtMs,
        process: state.progress.process,
        processResourceId: state.progress.processResourceId,
        providerResourceId: command.providerResourceId,
        resumed: state.progress.resumed,
        stage: 'publishing_opened',
      },
    },
    event,
  );
};
