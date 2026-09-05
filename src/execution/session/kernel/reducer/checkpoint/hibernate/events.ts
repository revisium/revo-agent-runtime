import type { AgentFault } from '../../../../../../contracts/manager/core.js';
import type { SessionCommand } from '../../../command/session-command.js';
import {
  acknowledgeSessionEvent,
  appendEffect,
  nextEffectCorrelation,
  type SessionTransition,
  unchangedTransition,
} from '../../transition.js';
import { completedHibernation, failedHibernation, type HibernatingState } from './state.js';

type EventOutcome = Extract<SessionCommand, { readonly type: `event.${string}` }>;

const eventFault = (command: EventOutcome): AgentFault => {
  if (command.type !== 'event.applied' && command.type !== 'event.timed_out_then_applied')
    return command.fault;
  return {
    code: 'revo.agent.event_conflict',
    message: 'The hibernation event conflicted with durable history.',
    phase: 'session_delivery',
    retryable: false,
  };
};

export const reduceHibernationEvent = (
  state: HibernatingState,
  command: EventOutcome,
): SessionTransition => {
  if (
    state.progress.stage !== 'publishing' ||
    state.events.inFlight?.correlation.effectId !== command.correlation.effectId
  )
    return unchangedTransition(state);
  if (
    (command.type !== 'event.applied' && command.type !== 'event.timed_out_then_applied') ||
    command.result.state !== 'appended'
  ) {
    const fault = eventFault(command);
    const failedState: HibernatingState = {
      ...state,
      events: {
        ...(state.events.cursor === undefined ? {} : { cursor: state.events.cursor }),
        pending: [],
      },
    };
    return appendEffect(
      {
        effects: [],
        state: failedHibernation(
          failedState,
          fault,
          state.progress.finishedAt,
          state.progress.output,
        ),
      },
      {
        callId: state.callId,
        correlation: nextEffectCorrelation(state),
        fault,
        type: 'public.reject',
      },
    );
  }
  const acknowledged = acknowledgeSessionEvent(state, command.correlation)!;
  if (acknowledged.event.type !== 'session.hibernated') return acknowledged.transition;
  const terminal = completedHibernation(acknowledged.transition.state, state.progress);
  return appendEffect(
    { effects: acknowledged.transition.effects, state: terminal },
    {
      callId: state.callId,
      correlation: nextEffectCorrelation(terminal),
      resolution: {
        kind: 'hibernate',
        result: { resumeToken: state.progress.resumeToken, state: 'hibernated' },
      },
      type: 'public.resolve',
    },
  );
};
