import type { AgentFault } from '../../../../../contracts/manager/core.js';
import type { EffectOutcomeCommand } from '../../command/effect.js';
import {
  appendEffect,
  nextEffectCorrelation,
  type SessionTransition,
  unchangedTransition,
} from '../transition.js';
import type { OpeningState } from './state.js';
import { cancelOpeningTimer } from './timing.js';

const clearedEvents = (state: OpeningState) => ({
  ...(state.events.cursor === undefined ? {} : { cursor: state.events.cursor }),
  pending: [] as const,
});

export const failOpeningBeforeProcess = (
  state: OpeningState,
  fault: AgentFault,
  finishedAt: string,
): SessionTransition => {
  const { callId, progress: _progress, ...base } = state;
  let transition: SessionTransition = {
    effects: [],
    state: {
      ...base,
      error: fault,
      events: clearedEvents(state),
      finishedAt,
      interactions: [],
      status: 'failed',
      timers: [],
    },
  };
  for (const timer of state.timers) transition = cancelOpeningTimer(transition, timer);
  const correlation = nextEffectCorrelation(transition.state);
  return appendEffect(transition, { callId, correlation, fault, type: 'public.reject' });
};

const uncertainOpeningCleanup = (state: OpeningState, fault: AgentFault): SessionTransition => {
  const { callId, progress: _progress, ...base } = state;
  let transition: SessionTransition = {
    effects: [],
    state: {
      ...base,
      error: fault,
      events: clearedEvents(state),
      interactions: [],
      status: 'cleanup_uncertain',
      timers: [],
    },
  };
  for (const timer of state.timers) transition = cancelOpeningTimer(transition, timer);
  const correlation = nextEffectCorrelation(transition.state);
  return appendEffect(transition, { callId, correlation, fault, type: 'public.reject' });
};

export const beginOpeningProcessCleanup = (
  state: OpeningState,
  fault: AgentFault,
  afterCleanup: 'fail' | 'remove_state' | 'uncertain',
): SessionTransition => {
  if (!('process' in state.progress))
    return failOpeningBeforeProcess(state, fault, state.acceptedAt);
  const correlation = nextEffectCorrelation(state);
  return appendEffect(
    {
      effects: [],
      state: {
        ...state,
        progress: {
          afterCleanup,
          correlation,
          fault,
          process: state.progress.process,
          processResourceId: state.progress.processResourceId,
          stage: 'cleaning_process',
        },
      },
    },
    {
      correlation,
      process: state.progress.process,
      processResourceId: state.progress.processResourceId,
      reason: fault.message,
      timeoutMs: state.limits.operationTimeoutMs,
      type: 'process.cleanup',
    },
  );
};

export const reduceOpeningCleanup = (
  state: OpeningState,
  command:
    | Extract<
        EffectOutcomeCommand,
        { readonly type: 'process.cleanup.confirmed' | 'process.cleanup.uncertain' }
      >
    | Extract<
        EffectOutcomeCommand,
        { readonly type: 'persistence.applied' | 'persistence.failed' | 'persistence.unknown' }
      >,
): SessionTransition => {
  if (!('correlation' in state.progress)) return unchangedTransition(state);
  if (state.progress.correlation.effectId !== command.correlation.effectId)
    return unchangedTransition(state);
  if (state.progress.stage === 'cleaning_process') {
    if (command.type === 'process.cleanup.uncertain')
      return uncertainOpeningCleanup(state, command.fault);
    if (command.type !== 'process.cleanup.confirmed') return unchangedTransition(state);
    if (state.progress.afterCleanup === 'uncertain')
      return uncertainOpeningCleanup(state, state.progress.fault);
    if (state.progress.afterCleanup === 'fail')
      return failOpeningBeforeProcess(state, state.progress.fault, command.observedAt);
    const correlation = nextEffectCorrelation(state);
    return appendEffect(
      {
        effects: [],
        state: {
          ...state,
          progress: { correlation, fault: state.progress.fault, stage: 'removing_state' },
        },
      },
      {
        correlation,
        incarnationId: state.incarnationId,
        timeoutMs: state.limits.operationTimeoutMs,
        type: 'persistence.remove',
      },
    );
  }
  if (state.progress.stage !== 'removing_state') return unchangedTransition(state);
  if (command.type === 'persistence.applied')
    return failOpeningBeforeProcess(state, state.progress.fault, command.observedAt);
  if (command.type === 'persistence.failed' || command.type === 'persistence.unknown')
    return uncertainOpeningCleanup(state, command.fault);
  return unchangedTransition(state);
};

export const openingEventConflictFault = (): AgentFault => ({
  code: 'revo.agent.event_conflict',
  message: 'Agent session event append conflicted with durable history.',
  phase: 'session_delivery',
  retryable: false,
});
