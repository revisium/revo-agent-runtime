import type { PublicSessionCommand } from '../../command/public.js';
import type { SessionState } from '../../model/session-state.js';
import {
  appendEffect,
  nextEffectCorrelation,
  type SessionTransition,
  unchangedTransition,
} from '../transition.js';
import type { TerminalizingSession } from './state.js';

type RunningSession = Extract<SessionState, { readonly status: 'running' }>;

export const rejectBusyClose = (
  state: RunningSession,
  command: Extract<PublicSessionCommand, { readonly type: 'session.close' }>,
): SessionTransition => {
  const correlation = nextEffectCorrelation(state);
  return appendEffect(unchangedTransition(state), {
    callId: command.call.callId,
    correlation,
    fault: {
      code: 'revo.agent.session_busy',
      message: 'Graceful close requires an idle session.',
      phase: 'session_terminal',
      retryable: true,
    },
    type: 'public.reject',
  });
};

export const coalesceTerminalCommand = (
  state: TerminalizingSession,
  command: Extract<PublicSessionCommand, { readonly type: 'session.close' | 'session.cancel' }>,
): SessionTransition => {
  if (command.type === 'session.close') {
    if (state.status !== 'closing' || state.intent.outcome !== 'closed')
      return unchangedTransition(state);
    return {
      effects: [],
      state: state.callIds.includes(command.call.callId)
        ? state
        : { ...state, callIds: [...state.callIds, command.call.callId] },
    };
  }
  const correlation = nextEffectCorrelation(state);
  return appendEffect(
    {
      effects: [],
      state:
        state.intent.outcome === 'closed'
          ? {
              ...state,
              intent: {
                ...(command.reason === undefined ? {} : { reason: command.reason }),
                outcome: 'cancelled',
              },
              status: 'cancelling',
            }
          : state,
    },
    {
      callId: command.call.callId,
      correlation,
      resolution: { kind: 'cancel_session', result: { state: 'requested' } },
      type: 'public.resolve',
    },
  );
};
