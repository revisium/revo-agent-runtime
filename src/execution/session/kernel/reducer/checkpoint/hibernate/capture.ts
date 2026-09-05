import type { AgentFault } from '../../../../../../contracts/manager/core.js';
import type { AgentSessionResumeToken } from '../../../../../../contracts/session/lifecycle/checkpoint.js';
import type { SessionCommand } from '../../../command/session-command.js';
import { clearAllTimers } from '../../timer/all.js';
import { resetInactivity } from '../../timer/inactivity.js';
import {
  appendEffect,
  nextEffectCorrelation,
  nextSessionEventId,
  type SessionTransition,
  unchangedTransition,
} from '../../transition.js';
import { idleFromHibernation, type HibernatingState } from './state.js';

type CaptureOutcome = Extract<SessionCommand, { readonly type: `checkpoint.${string}` }>;

const invalidFault = (): AgentFault => ({
  code: 'revo.agent.checkpoint_invalid',
  message: 'The captured resume token does not match its reserved hibernation event cursor.',
  phase: 'session_checkpointing',
  retryable: false,
});

const matchesToken = (state: HibernatingState, token: AgentSessionResumeToken): boolean =>
  token.resumeTokenId === state.resumeTokenId &&
  token.sessionId === state.sessionId &&
  token.pin.agentId === state.pin.agentId &&
  token.pin.agentVersion === state.pin.agentVersion &&
  token.pin.definitionDigest === state.pin.definitionDigest &&
  token.cursor.streamId === state.streamId &&
  token.cursor.sequence === state.nextEventSequence &&
  token.cursor.eventId === nextSessionEventId(state);

const rejectCapture = (
  state: HibernatingState,
  fault: AgentFault,
  observedAtMs: number,
): SessionTransition => {
  let transition = resetInactivity(unchangedTransition(idleFromHibernation(state)), observedAtMs);
  return appendEffect(transition, {
    callId: state.callId,
    correlation: nextEffectCorrelation(transition.state),
    fault,
    type: 'public.reject',
  });
};

export const reduceHibernationCapture = (
  state: HibernatingState,
  command: CaptureOutcome,
): SessionTransition => {
  if (
    state.progress.stage !== 'capturing' ||
    state.progress.correlation.effectId !== command.correlation.effectId
  )
    return unchangedTransition(state);
  if (command.type !== 'checkpoint.captured')
    return rejectCapture(state, command.fault, command.observedAtMs);
  if (command.kind !== 'hibernate' || !matchesToken(state, command.resumeToken))
    return rejectCapture(state, invalidFault(), command.observedAtMs);

  let transition: SessionTransition<HibernatingState> = clearAllTimers(unchangedTransition(state));
  const closeCorrelation = nextEffectCorrelation(transition.state);
  transition = appendEffect(transition, {
    correlation: closeCorrelation,
    ...(state.reason === undefined ? {} : { reason: state.reason }),
    providerResourceId: state.providerResourceId,
    timeoutMs: state.limits.operationTimeoutMs,
    type: 'provider.close',
  });
  const cleanupCorrelation = nextEffectCorrelation(transition.state);
  return appendEffect(
    {
      effects: transition.effects,
      state: {
        ...transition.state,
        progress: {
          correlation: cleanupCorrelation,
          resumeToken: command.resumeToken,
          stage: 'cleaning_process',
        },
      },
    },
    {
      correlation: cleanupCorrelation,
      process: state.process,
      processResourceId: state.processResourceId,
      ...(state.reason === undefined ? {} : { reason: state.reason }),
      timeoutMs: state.limits.operationTimeoutMs,
      type: 'process.cleanup',
    },
  );
};
