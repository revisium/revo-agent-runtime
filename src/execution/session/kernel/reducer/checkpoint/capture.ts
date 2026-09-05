import type { AgentFault } from '../../../../../contracts/manager/core.js';
import type { SessionCheckpointedEvent } from '../../../../../contracts/session/events/event.js';
import type { AgentSessionCheckpoint } from '../../../../../contracts/session/lifecycle/checkpoint.js';
import type { SessionCommand } from '../../command/session-command.js';
import { resetInactivity } from '../timer/inactivity.js';
import {
  appendEffect,
  nextEffectCorrelation,
  nextSessionEventId,
  queueSessionEvent,
  type SessionTransition,
  unchangedTransition,
} from '../transition.js';
import { idleFromCheckpoint, type CheckpointingState } from './state.js';

type CaptureOutcome = Extract<SessionCommand, { readonly type: `checkpoint.${string}` }>;

const invalidFault = (): AgentFault => ({
  code: 'revo.agent.checkpoint_invalid',
  message: 'The captured checkpoint does not match its reserved event cursor.',
  phase: 'session_checkpointing',
  retryable: false,
});

const matchesCheckpoint = (
  state: CheckpointingState,
  checkpoint: AgentSessionCheckpoint,
): boolean =>
  checkpoint.checkpointId === state.checkpointId &&
  checkpoint.sessionId === state.sessionId &&
  checkpoint.pin.agentId === state.pin.agentId &&
  checkpoint.pin.agentVersion === state.pin.agentVersion &&
  checkpoint.pin.definitionDigest === state.pin.definitionDigest &&
  checkpoint.cursor.streamId === state.streamId &&
  checkpoint.cursor.sequence === state.nextEventSequence &&
  checkpoint.cursor.eventId === nextSessionEventId(state);

const rejectCapture = (
  state: CheckpointingState,
  fault: AgentFault,
  observedAtMs: number,
): SessionTransition => {
  let transition = resetInactivity(unchangedTransition(idleFromCheckpoint(state)), observedAtMs);
  return appendEffect(transition, {
    callId: state.callId,
    correlation: nextEffectCorrelation(transition.state),
    fault,
    type: 'public.reject',
  });
};

export const reduceCheckpointCapture = (
  state: CheckpointingState,
  command: CaptureOutcome,
): SessionTransition => {
  if (
    state.progress.stage !== 'capturing' ||
    state.progress.correlation.effectId !== command.correlation.effectId
  )
    return unchangedTransition(state);
  if (command.type !== 'checkpoint.captured')
    return rejectCapture(state, command.fault, command.observedAtMs);
  if (command.kind !== 'checkpoint' || !matchesCheckpoint(state, command.checkpoint))
    return rejectCapture(state, invalidFault(), command.observedAtMs);
  const event: SessionCheckpointedEvent = {
    checkpointId: state.checkpointId,
    checkpointSha256: command.checkpoint.sha256,
    eventId: nextSessionEventId(state),
    observedAt: command.observedAt,
    schemaVersion: 'agent-session-event/v1',
    sequence: state.nextEventSequence,
    sessionId: state.sessionId,
    streamId: state.streamId,
    type: 'session.checkpointed',
  };
  return queueSessionEvent(
    { ...state, progress: { checkpoint: command.checkpoint, stage: 'publishing' } },
    event,
  );
};
