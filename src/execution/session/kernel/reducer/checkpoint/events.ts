import type { SessionCommand } from '../../command/session-command.js';
import { failActiveSession } from '../terminal/control.js';
import {
  beginTerminalResourceCleanup,
  clearSessionTimers,
  terminalizingState,
} from '../terminal/state.js';
import { resetInactivity } from '../timer/inactivity.js';
import {
  acknowledgeSessionEvent,
  appendEffect,
  nextEffectCorrelation,
  type SessionTransition,
  unchangedTransition,
} from '../transition.js';
import { idleFromCheckpoint, type CheckpointingState } from './state.js';

type EventOutcome = Extract<SessionCommand, { readonly type: `event.${string}` }>;

const failCheckpoint = (
  state: CheckpointingState,
  fault: Extract<EventOutcome, { readonly type: 'event.failed' }>['fault'],
): SessionTransition => {
  let transition = failActiveSession(idleFromCheckpoint(state), fault);
  return appendEffect(transition, {
    callId: state.callId,
    correlation: nextEffectCorrelation(transition.state),
    fault,
    type: 'public.reject',
  });
};

export const reduceCheckpointEvent = (
  state: CheckpointingState,
  command: EventOutcome,
): SessionTransition => {
  if (
    state.progress.stage !== 'publishing' ||
    state.events.inFlight?.correlation.effectId !== command.correlation.effectId
  )
    return unchangedTransition(state);
  if (command.type !== 'event.applied' && command.type !== 'event.timed_out_then_applied')
    return failCheckpoint(state, command.fault);
  if (command.result.state !== 'appended')
    return failCheckpoint(state, {
      code: 'revo.agent.event_conflict',
      message: 'Checkpoint event append conflicted with durable history.',
      phase: 'session_delivery',
      retryable: false,
    });
  const acknowledged = acknowledgeSessionEvent(state, command.correlation);
  if (acknowledged?.event.type !== 'session.checkpointed') return unchangedTransition(state);
  if (state.terminalAfterCheckpoint !== undefined) {
    const idle = idleFromCheckpoint(acknowledged.transition.state);
    const terminal = terminalizingState(idle, state.terminalAfterCheckpoint, {
      correlation: nextEffectCorrelation(idle),
      stage: 'closing_provider',
    });
    let transition = beginTerminalResourceCleanup(
      clearSessionTimers({ effects: acknowledged.transition.effects, state: terminal }),
      'reason' in state.terminalAfterCheckpoint ? state.terminalAfterCheckpoint.reason : undefined,
    );
    return appendEffect(transition, {
      callId: state.callId,
      correlation: nextEffectCorrelation(transition.state),
      resolution: { checkpoint: state.progress.checkpoint, kind: 'checkpoint' },
      type: 'public.resolve',
    });
  }
  let transition = resetInactivity(
    {
      effects: acknowledged.transition.effects,
      state: idleFromCheckpoint(acknowledged.transition.state),
    },
    command.observedAtMs,
  );
  return appendEffect(transition, {
    callId: state.callId,
    correlation: nextEffectCorrelation(transition.state),
    resolution: { checkpoint: state.progress.checkpoint, kind: 'checkpoint' },
    type: 'public.resolve',
  });
};
