import type { PublicSessionCommand } from '../../command/public.js';
import type { SessionState } from '../../model/session-state.js';
import { pauseInactivity } from '../timer/inactivity.js';
import {
  appendEffect,
  nextEffectCorrelation,
  nextSessionEventCursor,
  type SessionTransition,
  unchangedTransition,
} from '../transition.js';

type ActiveState = Extract<SessionState, { readonly status: 'idle' | 'running' }>;
type CheckpointCommand = Extract<PublicSessionCommand, { readonly type: 'session.checkpoint' }>;

const reject = (
  state: ActiveState,
  command: CheckpointCommand,
  code: 'revo.agent.session_busy' | 'revo.agent.checkpoint_invalid',
): SessionTransition =>
  appendEffect(unchangedTransition(state), {
    callId: command.call.callId,
    correlation: nextEffectCorrelation(state),
    fault: {
      code,
      message:
        code === 'revo.agent.session_busy'
          ? 'Checkpoint capture requires an idle session.'
          : 'Checkpoint capture requires a durable session cursor.',
      phase: 'session_checkpointing',
      retryable: code === 'revo.agent.session_busy',
    },
    type: 'public.reject',
  });

export const startCheckpoint = (
  state: ActiveState,
  command: CheckpointCommand,
): SessionTransition => {
  if (state.status !== 'idle' || state.interactions.length > 0)
    return reject(state, command, 'revo.agent.session_busy');
  if (state.events.cursor === undefined)
    return reject(state, command, 'revo.agent.checkpoint_invalid');
  const paused = pauseInactivity(unchangedTransition(state));
  const correlation = nextEffectCorrelation(paused.state);
  return appendEffect(
    {
      effects: paused.effects,
      state: {
        ...paused.state,
        callId: command.call.callId,
        checkpointId: command.checkpointId,
        progress: { correlation, stage: 'capturing' },
        status: 'checkpointing',
      },
    },
    {
      checkpointId: command.checkpointId,
      correlation,
      cursor: nextSessionEventCursor(state),
      kind: 'checkpoint',
      maxBytes: state.limits.maxCheckpointBytes,
      pin: state.pin,
      providerResourceId: state.providerResourceId,
      timeoutMs: state.limits.operationTimeoutMs,
      type: 'checkpoint.capture',
      usageBaseline: state.usage,
    },
  );
};
