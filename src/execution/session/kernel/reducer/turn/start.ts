import type { TurnStartedEvent } from '../../../../../contracts/session/events/event.js';
import type { PublicSessionCommand } from '../../command/public.js';
import type { SessionState } from '../../model/session-state.js';
import { rejectPublicCommand } from '../public/settlement.js';
import { resetInactivity } from '../timer/inactivity.js';
import {
  appendEffect,
  nextEffectCorrelation,
  nextSessionEventId,
  queueSessionEvent,
  type SessionTransition,
  unchangedTransition,
} from '../transition.js';

type IdleState = Extract<SessionState, { readonly status: 'idle' }>;
type RunningState = Extract<SessionState, { readonly status: 'running' }>;
type SendTurnCommand = Extract<PublicSessionCommand, { readonly type: 'turn.send' }>;

export const rejectBusyTurn = (
  state: RunningState,
  command: SendTurnCommand,
): SessionTransition => {
  return rejectPublicCommand(
    state,
    command,
    'revo.agent.session_busy',
    'The session already has an active turn.',
  );
};

export const startTurn = (state: IdleState, command: SendTurnCommand): SessionTransition => {
  if (command.call.turnId !== command.input.turnId) return unchangedTransition(state);
  const accepted = state.acceptedTurnIds ?? [];
  if (accepted.includes(command.input.turnId))
    return rejectPublicCommand(
      state,
      command,
      'revo.agent.turn_duplicate',
      'The turn identity was already accepted.',
    );
  if (accepted.length >= 10_000)
    return rejectPublicCommand(
      state,
      command,
      'revo.agent.session_identity_capacity',
      'The session turn identity capacity is exhausted.',
    );
  const event: TurnStartedEvent = {
    eventId: nextSessionEventId(state),
    ...(command.metadata === undefined ? {} : { metadata: command.metadata }),
    observedAt: command.observedAt,
    schemaVersion: 'agent-session-event/v1',
    sequence: state.nextEventSequence,
    sessionId: state.sessionId,
    streamId: state.streamId,
    turnId: command.input.turnId,
    type: 'turn.started',
  };
  return resetInactivity(
    queueSessionEvent(
      {
        ...state,
        acceptedTurnIds: [...accepted, command.input.turnId],
        status: 'running',
        turn: {
          handleCallId: command.call.callId,
          ...(command.metadata === undefined ? {} : { metadata: command.metadata }),
          prompt: command.input.prompt,
          resultCallId: command.resultCallId,
          status: 'starting',
          turnId: command.input.turnId,
        },
      },
      event,
    ),
    command.observedAtMs,
  );
};

export function beginProviderPrompt(
  state: RunningState,
  transition: SessionTransition<RunningState>,
): SessionTransition<RunningState>;
export function beginProviderPrompt(
  state: RunningState,
  transition: SessionTransition,
): SessionTransition;
export function beginProviderPrompt(
  state: RunningState,
  transition: SessionTransition,
): SessionTransition {
  if (state.turn.status !== 'starting' || transition.state.status !== 'running') return transition;
  const turn = state.turn;
  const correlation = nextEffectCorrelation(transition.state, turn.turnId);
  let result = appendEffect(
    {
      effects: transition.effects,
      state: {
        ...transition.state,
        turn: {
          ...turn,
          correlation,
          message: { content: '', role: 'assistant' },
          status: 'prompting',
        },
      },
    },
    {
      correlation,
      input: {
        ...(turn.metadata === undefined ? {} : { metadata: turn.metadata }),
        prompt: turn.prompt,
        turnId: turn.turnId,
      },
      providerResourceId: state.providerResourceId,
      timeoutMs: state.limits.operationTimeoutMs,
      type: 'provider.prompt',
    },
  );
  const publicCorrelation = nextEffectCorrelation(result.state, turn.turnId);
  result = appendEffect(result, {
    callId: turn.handleCallId,
    correlation: publicCorrelation,
    resolution: { kind: 'turn_ready', turnId: turn.turnId },
    type: 'public.resolve',
  });
  return result;
}
