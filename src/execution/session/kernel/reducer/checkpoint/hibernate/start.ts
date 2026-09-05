import type { PublicSessionCommand } from '../../../command/public.js';
import type { SessionState } from '../../../model/session-state.js';
import { pauseInactivity } from '../../timer/inactivity.js';
import {
  appendEffect,
  nextEffectCorrelation,
  type SessionTransition,
  unchangedTransition,
} from '../../transition.js';

type ActiveState = Extract<SessionState, { readonly status: 'idle' | 'running' }>;
type HibernateCommand = Extract<PublicSessionCommand, { readonly type: 'session.hibernate' }>;
type RejectionCode =
  | 'revo.agent.session_busy'
  | 'revo.agent.checkpoint_invalid'
  | 'revo.agent.checkpoint_unsupported';

const rejectionMessage = (code: RejectionCode): string => {
  if (code === 'revo.agent.session_busy') return 'Hibernation requires an idle session.';
  if (code === 'revo.agent.checkpoint_unsupported')
    return 'The provider did not negotiate native continuation.';
  return 'Hibernation requires a durable session cursor.';
};

const reject = (
  state: ActiveState,
  command: HibernateCommand,
  code: RejectionCode,
): SessionTransition =>
  appendEffect(unchangedTransition(state), {
    callId: command.call.callId,
    correlation: nextEffectCorrelation(state),
    fault: {
      code,
      message: rejectionMessage(code),
      phase: 'session_checkpointing',
      retryable: code === 'revo.agent.session_busy',
    },
    type: 'public.reject',
  });

export const startHibernation = (
  state: ActiveState,
  command: HibernateCommand,
): SessionTransition => {
  if (state.status !== 'idle' || state.interactions.length > 0)
    return reject(state, command, 'revo.agent.session_busy');
  if (state.capabilities.resume !== 'native')
    return reject(state, command, 'revo.agent.checkpoint_unsupported');
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
        ...(command.reason === undefined ? {} : { reason: command.reason }),
        progress: { correlation, stage: 'capturing' },
        resumeTokenId: command.resumeTokenId,
        status: 'hibernating',
      },
    },
    {
      correlation,
      cursor: state.events.cursor,
      kind: 'hibernate',
      maxBytes: state.limits.maxCheckpointBytes,
      pin: state.pin,
      providerResourceId: state.providerResourceId,
      resumeTokenId: command.resumeTokenId,
      timeoutMs: state.limits.operationTimeoutMs,
      type: 'checkpoint.capture',
      usageBaseline: state.usage,
    },
  );
};
