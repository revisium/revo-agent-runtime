import type { SessionCommand } from '../../command/session-command.js';
import type { SessionState } from '../../model/session-state.js';
import { failActiveSession } from '../terminal/control.js';
import {
  acknowledgeSessionEvent,
  type SessionTransition,
  unchangedTransition,
} from '../transition.js';
import { finishTurn } from './completion.js';
import { beginProviderPrompt } from './start.js';

type RunningState = Extract<SessionState, { readonly status: 'running' }>;
type EventOutcome = Extract<SessionCommand, { readonly type: `event.${string}` }>;

export const reduceTurnEvent = (state: RunningState, command: EventOutcome): SessionTransition => {
  const inFlight = state.events.inFlight;
  if (inFlight?.correlation.effectId !== command.correlation.effectId)
    return unchangedTransition(state);
  if (command.type !== 'event.applied' && command.type !== 'event.timed_out_then_applied')
    return failActiveSession(state, command.fault);
  if (command.result.state !== 'appended')
    return failActiveSession(state, {
      code: 'revo.agent.event_conflict',
      message: 'Agent session event append conflicted with durable history.',
      phase: 'session_delivery',
      retryable: false,
    });
  // The in-flight correlation was matched above, so acknowledgement is total here.
  const acknowledged = acknowledgeSessionEvent(state, command.correlation)!;
  if (acknowledged.event.type === 'turn.started')
    return beginProviderPrompt(state, acknowledged.transition);
  if (acknowledged.event.type === 'turn.completed')
    return finishTurn(state, acknowledged.transition);
  return acknowledged.transition;
};
