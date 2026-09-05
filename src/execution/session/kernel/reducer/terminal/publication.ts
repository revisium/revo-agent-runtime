import type { EffectOutcomeCommand } from '../../command/effect.js';
import {
  acknowledgeSessionEvent,
  appendEffect,
  nextEffectCorrelation,
  type SessionTransition,
  unchangedTransition,
} from '../transition.js';
import type { TerminalizingSession } from './state.js';

const matchesProgress = (state: TerminalizingSession, effectId: string): boolean =>
  'correlation' in state.progress && state.progress.correlation.effectId === effectId;

const publishOutput = (
  state: TerminalizingSession,
  observedAt: string,
  status: 'hibernated' | 'closed' | 'cancelled' | 'timed_out' | 'failed',
  effects: SessionTransition['effects'],
): SessionTransition => {
  const correlation = nextEffectCorrelation(state);
  return appendEffect(
    { effects, state: { ...state, progress: { correlation, stage: 'publishing_output' } } },
    {
      correlation,
      maxBytes: state.limits.maxOutputBytes,
      outputDirectory: state.outputDirectory,
      publication: {
        acceptedAt: state.acceptedAt,
        ...(state.events.cursor === undefined ? {} : { cursor: state.events.cursor }),
        finishedAt: observedAt,
        openedAt: state.openedAt,
        pin: state.pin,
        sessionId: state.sessionId,
        status,
      },
      type: 'output.publish',
    },
  );
};

export const reduceTerminalEventOutcome = (
  state: TerminalizingSession,
  command: Extract<EffectOutcomeCommand, { readonly type: `event.${string}` }>,
): SessionTransition => {
  if (state.progress.stage !== 'publishing_event') return unchangedTransition(state);
  const inFlight = state.events.inFlight;
  if (inFlight?.correlation.effectId !== command.correlation.effectId)
    return unchangedTransition(state);
  if (command.type !== 'event.applied' && command.type !== 'event.timed_out_then_applied') {
    const failed = {
      ...state,
      events: {
        ...(state.events.cursor === undefined ? {} : { cursor: state.events.cursor }),
        pending: [] as const,
      },
      intent: { error: command.fault, outcome: 'failed' as const },
    };
    return publishOutput(failed, command.observedAt, 'failed', []);
  }
  if (command.result.state !== 'appended')
    return reduceTerminalEventOutcome(state, {
      correlation: command.correlation,
      fault: {
        code: 'revo.agent.event_conflict',
        message: 'Agent session terminal event conflicted with durable history.',
        phase: 'session_delivery',
        retryable: false,
      },
      observedAt: command.observedAt,
      observedAtMs: command.observedAtMs,
      type: 'event.failed',
    });
  // The in-flight correlation was matched above, so acknowledgement is total here.
  const acknowledged = acknowledgeSessionEvent(state, command.correlation)!;
  return publishOutput(
    acknowledged.transition.state,
    command.observedAt,
    state.intent.outcome,
    acknowledged.transition.effects,
  );
};

export const finishTerminal = (
  state: TerminalizingSession,
  command: Extract<EffectOutcomeCommand, { readonly type: `output.${string}` }>,
): SessionTransition => {
  if (
    state.progress.stage !== 'publishing_output' ||
    !matchesProgress(state, command.correlation.effectId)
  )
    return unchangedTransition(state);
  const {
    callIds,
    intent: previousIntent,
    progress: _progress,
    status: _status,
    ...active
  } = state;
  const {
    capabilities: _capabilities,
    lastTurn: _lastTurn,
    process: _process,
    processResourceId: _processResource,
    providerResourceId: _providerResource,
    ...base
  } = active;
  const intent =
    command.type === 'output.published'
      ? previousIntent
      : ({ error: command.output.error, outcome: 'failed' } as const);
  const terminal =
    intent.outcome === 'failed' || intent.outcome === 'timed_out'
      ? {
          ...base,
          error: intent.error,
          finishedAt: command.observedAt,
          output: command.output,
          status: intent.outcome,
        }
      : { ...base, finishedAt: command.observedAt, output: command.output, status: intent.outcome };
  let transition: SessionTransition = { effects: [], state: terminal };
  for (const callId of callIds) {
    const correlation = nextEffectCorrelation(transition.state);
    transition =
      intent.outcome === 'failed'
        ? appendEffect(transition, {
            callId,
            correlation,
            fault: intent.error,
            type: 'public.reject',
          })
        : appendEffect(transition, {
            callId,
            correlation,
            resolution: { kind: 'close', result: { state: 'closed' } },
            type: 'public.resolve',
          });
  }
  return transition;
};
