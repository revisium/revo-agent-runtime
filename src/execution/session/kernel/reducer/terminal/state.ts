import type { AgentFault } from '../../../../../contracts/manager/core.js';
import type { PublicSessionCommand } from '../../command/public.js';
import type { SessionState, TerminalIntent } from '../../model/session-state.js';
import { clearAllTimers } from '../timer/all.js';
import { appendEffect, nextEffectCorrelation, type SessionTransition } from '../transition.js';

export type ActiveSession = Extract<SessionState, { readonly status: 'idle' | 'running' }>;
export type TerminalizingSession = Extract<
  SessionState,
  { readonly status: 'closing' | 'cancelling' }
>;

export const timerFault = (kind: 'idle' | 'wall_clock'): AgentFault => ({
  code: 'revo.agent.timeout',
  details: { timer: kind },
  message:
    kind === 'idle' ? 'The session inactivity deadline elapsed.' : 'The session deadline elapsed.',
  phase: 'session_terminal',
  retryable: false,
});

export const clearSessionTimers = (
  transition: SessionTransition<TerminalizingSession>,
): SessionTransition<TerminalizingSession> => clearAllTimers(transition);

export const beginTerminalCleanup = (
  state: ActiveSession,
  command: Extract<PublicSessionCommand, { readonly type: 'session.close' | 'session.cancel' }>,
): SessionTransition => {
  const closing = command.type === 'session.close';
  const terminalState: TerminalizingSession = closing
    ? {
        ...state,
        callIds: [command.call.callId],
        intent: {
          ...(command.reason === undefined ? {} : { reason: command.reason }),
          outcome: 'closed',
        },
        progress: { stage: 'closing_provider', correlation: nextEffectCorrelation(state) },
        status: 'closing',
      }
    : {
        ...state,
        callIds: [],
        intent: {
          ...(command.reason === undefined ? {} : { reason: command.reason }),
          outcome: 'cancelled',
        },
        progress: { stage: 'closing_provider', correlation: nextEffectCorrelation(state) },
        status: 'cancelling',
      };
  let transition = beginTerminalResourceCleanup(
    clearSessionTimers({ effects: [], state: terminalState }),
    command.reason,
  );
  if (closing) return transition;
  const publicCorrelation = nextEffectCorrelation(transition.state);
  return appendEffect(transition, {
    callId: command.call.callId,
    correlation: publicCorrelation,
    resolution: { kind: 'cancel_session', result: { state: 'requested' } },
    type: 'public.resolve',
  });
};

export const beginTerminalResourceCleanup = (
  initial: SessionTransition<TerminalizingSession>,
  reason?: string,
): SessionTransition<TerminalizingSession> => {
  let transition = initial;
  const state = transition.state;
  const closeCorrelation = nextEffectCorrelation(transition.state);
  transition = appendEffect(transition, {
    correlation: closeCorrelation,
    ...(reason === undefined ? {} : { reason }),
    providerResourceId: state.providerResourceId,
    timeoutMs: state.limits.operationTimeoutMs,
    type: 'provider.close',
  });
  const cleanupCorrelation = nextEffectCorrelation(transition.state);
  transition = appendEffect(
    {
      effects: transition.effects,
      state: {
        ...transition.state,
        progress: { correlation: cleanupCorrelation, stage: 'cleaning_process' },
      },
    },
    {
      correlation: cleanupCorrelation,
      process: state.process,
      processResourceId: state.processResourceId,
      ...(reason === undefined ? {} : { reason }),
      timeoutMs: state.limits.operationTimeoutMs,
      type: 'process.cleanup',
    },
  );
  return transition;
};

export const terminalizingState = (
  state: ActiveSession,
  intent: TerminalIntent,
  progress: TerminalizingSession['progress'],
): TerminalizingSession => {
  const active = state.status === 'running' ? (({ turn: _turn, ...rest }) => rest)(state) : state;
  return intent.outcome === 'closed'
    ? { ...active, callIds: [], intent, progress, status: 'closing' }
    : { ...active, callIds: [], intent, progress, status: 'cancelling' };
};
