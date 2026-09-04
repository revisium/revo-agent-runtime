import type { AgentSessionEvent } from '../../../../../contracts/session/events/event.js';
import type { ProviderCommand } from '../../command/provider.js';
import type { SessionState } from '../../model/session-state.js';
import {
  nextSessionEventId,
  queueSessionEvent,
  type SessionTransition,
  unchangedTransition,
} from '../transition.js';
import { resetTurnInactivity } from './timing.js';

type RunningState = Extract<SessionState, { readonly status: 'running' }>;

const baseEvent = (state: RunningState, command: ProviderCommand) => ({
  eventId: nextSessionEventId(state),
  observedAt: command.observedAt,
  schemaVersion: 'agent-session-event/v1' as const,
  sequence: state.nextEventSequence,
  sessionId: state.sessionId,
  streamId: state.streamId,
  turnId: state.turn.turnId,
});

const updateEvent = (
  state: RunningState,
  command: ProviderCommand,
): AgentSessionEvent | undefined => {
  const base = baseEvent(state, command);
  switch (command.type) {
    case 'provider.message_delta':
      return { ...base, content: command.content, type: 'assistant.message.delta' };
    case 'provider.message_completed':
      return {
        ...base,
        contentBytes: command.contentBytes,
        contentSha256: command.contentSha256,
        role: 'assistant',
        type: 'assistant.message.completed',
      };
    case 'provider.progress':
      return { ...base, message: command.message, type: 'agent.progress' };
    case 'provider.tool':
      return {
        ...base,
        kind: command.kind,
        status: command.status,
        title: command.title,
        toolCallId: command.toolCallId,
        type: 'tool.activity',
      };
    case 'provider.plan':
      return { ...base, items: command.items, type: 'plan.updated' };
    case 'provider.usage':
      return { ...base, type: 'usage.updated', usage: command.usage };
    case 'provider.interaction_requested':
      return undefined;
  }
  return undefined;
};

export const reduceProviderUpdate = (
  state: RunningState,
  command: ProviderCommand,
): SessionTransition => {
  if (state.turn.status === 'starting' || state.turn.status === 'settling')
    return unchangedTransition(state);
  if (
    state.turn.correlation.effectId !== command.correlation.effectId ||
    state.turn.turnId !== command.correlation.turnId
  )
    return unchangedTransition(state);
  const event = updateEvent(state, command);
  if (event === undefined) return unchangedTransition(state);
  let turn = { ...state.turn, status: 'streaming' as const };
  if (command.type === 'provider.message_delta')
    turn = {
      ...turn,
      message: { ...turn.message, content: turn.message.content + command.content },
    };
  else if (command.type === 'provider.usage') turn = { ...turn, usage: command.usage };
  return resetTurnInactivity(
    queueSessionEvent(
      {
        ...state,
        turn,
        ...(command.type === 'provider.usage' ? { usage: command.usage } : {}),
      },
      event,
    ),
    command.observedAtMs,
  );
};
