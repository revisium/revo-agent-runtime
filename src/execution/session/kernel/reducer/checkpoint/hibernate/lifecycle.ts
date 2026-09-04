import type { AgentFault } from '../../../../../../contracts/manager/core.js';
import type { SessionHibernatedEvent } from '../../../../../../contracts/session/events/event.js';
import type { SessionCommand } from '../../../command/session-command.js';
import {
  appendEffect,
  nextEffectCorrelation,
  nextSessionEventId,
  queueSessionEvent,
  type SessionTransition,
  unchangedTransition,
} from '../../transition.js';
import { failedHibernation, uncertainHibernation, type HibernatingState } from './state.js';

type CleanupOutcome = Extract<SessionCommand, { readonly type: `process.cleanup.${string}` }>;
type PersistenceOutcome = Extract<
  SessionCommand,
  {
    readonly type: 'persistence.applied' | 'persistence.failed' | 'persistence.unknown';
  }
>;
type OutputOutcome = Extract<SessionCommand, { readonly type: `output.${string}` }>;

const matchesProgress = (state: HibernatingState, effectId: string): boolean =>
  'correlation' in state.progress && state.progress.correlation.effectId === effectId;

const reject = (
  transition: SessionTransition,
  callId: string,
  fault: AgentFault,
): SessionTransition =>
  appendEffect(transition, {
    callId,
    correlation: nextEffectCorrelation(transition.state),
    fault,
    type: 'public.reject',
  });

export const reduceHibernationCleanup = (
  state: HibernatingState,
  command: CleanupOutcome,
): SessionTransition => {
  if (
    state.progress.stage !== 'cleaning_process' ||
    !matchesProgress(state, command.correlation.effectId)
  )
    return unchangedTransition(state);
  if (command.type === 'process.cleanup.uncertain')
    return reject(
      { effects: [], state: uncertainHibernation(state, command.fault, true) },
      state.callId,
      command.fault,
    );
  const correlation = nextEffectCorrelation(state);
  return appendEffect(
    {
      effects: [],
      state: {
        ...state,
        progress: {
          correlation,
          finishedAt: command.observedAt,
          resumeToken: state.progress.resumeToken,
          stage: 'removing_state',
        },
      },
    },
    {
      correlation,
      incarnationId: state.incarnationId,
      timeoutMs: state.limits.operationTimeoutMs,
      type: 'persistence.remove',
    },
  );
};

const removalFault = (
  command: Exclude<PersistenceOutcome, { readonly type: 'persistence.applied' }>,
): AgentFault => command.fault;

export const reduceHibernationRemoval = (
  state: HibernatingState,
  command: PersistenceOutcome,
): SessionTransition => {
  if (
    state.progress.stage !== 'removing_state' ||
    !matchesProgress(state, command.correlation.effectId)
  )
    return unchangedTransition(state);
  if (command.type !== 'persistence.applied') {
    const fault = removalFault(command);
    return reject(
      { effects: [], state: uncertainHibernation(state, fault, false) },
      state.callId,
      fault,
    );
  }
  const correlation = nextEffectCorrelation(state);
  return appendEffect(
    {
      effects: [],
      state: {
        ...state,
        progress: { ...state.progress, correlation, stage: 'publishing_output' },
      },
    },
    {
      correlation,
      maxBytes: state.limits.maxOutputBytes,
      outputDirectory: state.outputDirectory,
      publication: {
        acceptedAt: state.acceptedAt,
        ...(state.events.cursor === undefined ? {} : { cursor: state.events.cursor }),
        finishedAt: state.progress.finishedAt,
        openedAt: state.openedAt,
        pin: state.pin,
        sessionId: state.sessionId,
        status: 'hibernated',
      },
      type: 'output.publish',
    },
  );
};

export const reduceHibernationOutput = (
  state: HibernatingState,
  command: OutputOutcome,
): SessionTransition => {
  if (
    state.progress.stage !== 'publishing_output' ||
    !matchesProgress(state, command.correlation.effectId)
  )
    return unchangedTransition(state);
  if (command.type !== 'output.published')
    return reject(
      {
        effects: [],
        state: failedHibernation(
          state,
          command.output.error,
          state.progress.finishedAt,
          command.output,
        ),
      },
      state.callId,
      command.output.error,
    );
  const event: SessionHibernatedEvent = {
    eventId: nextSessionEventId(state),
    observedAt: command.observedAt,
    resumeTokenId: state.progress.resumeToken.resumeTokenId,
    resumeTokenSha256: state.progress.resumeToken.sha256,
    schemaVersion: 'agent-session-event/v1',
    sequence: state.nextEventSequence,
    sessionId: state.sessionId,
    streamId: state.streamId,
    type: 'session.hibernated',
  };
  return queueSessionEvent(
    {
      ...state,
      progress: {
        finishedAt: state.progress.finishedAt,
        output: command.output,
        resumeToken: state.progress.resumeToken,
        stage: 'publishing',
      },
    },
    event,
  );
};
