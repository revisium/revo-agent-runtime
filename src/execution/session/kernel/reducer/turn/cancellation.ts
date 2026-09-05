import type { CancelAgentSessionTurnResult } from '../../../../../contracts/session/lifecycle/result.js';
import type { PublicSessionCommand } from '../../command/public.js';
import type { SessionState } from '../../model/session-state.js';
import { appendEffect, nextEffectCorrelation, type SessionTransition } from '../transition.js';
import { projectTurnResult } from './result.js';

type RunningState = Extract<SessionState, { readonly status: 'running' }>;
type CancelTurnCommand = Extract<PublicSessionCommand, { readonly type: 'turn.cancel' }>;

const resolveCancellation = (
  transition: SessionTransition,
  command: CancelTurnCommand,
  result: CancelAgentSessionTurnResult,
): SessionTransition => {
  const correlation = nextEffectCorrelation(transition.state, command.turnId);
  return appendEffect(transition, {
    callId: command.call.callId,
    correlation,
    resolution: { kind: 'cancel_turn', result },
    type: 'public.resolve',
  });
};

export const cancelTurn = (state: RunningState, command: CancelTurnCommand): SessionTransition => {
  if (command.turnId !== state.turn.turnId || command.call.turnId !== state.turn.turnId)
    return { effects: [], state };
  if (state.turn.status === 'settling') {
    if (state.turn.progress.stage === 'publishing_completion')
      return resolveCancellation({ effects: [], state }, command, {
        result: projectTurnResult(state.turn),
        state: 'already_completed',
      });
    return resolveCancellation({ effects: [], state }, command, { state: 'requested' });
  }
  if (state.turn.status === 'starting')
    return resolveCancellation({ effects: [], state }, command, { state: 'requested' });
  const cancellationCorrelation = nextEffectCorrelation(state, state.turn.turnId);
  const cancelling = appendEffect(
    {
      effects: [],
      state: {
        ...state,
        turn: {
          ...state.turn,
          progress: {
            cancellationCorrelation,
            outcome: { status: 'cancelled' },
            stage: 'awaiting_provider',
          },
          status: 'settling',
        },
      },
    },
    {
      correlation: cancellationCorrelation,
      ...(command.reason === undefined ? {} : { reason: command.reason }),
      providerResourceId: state.providerResourceId,
      timeoutMs: state.limits.operationTimeoutMs,
      turnId: state.turn.turnId,
      type: 'provider.turn.cancel',
    },
  );
  return resolveCancellation(cancelling, command, { state: 'requested' });
};
