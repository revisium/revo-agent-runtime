import type { ProviderCommand } from '../command/provider.js';
import type { SessionCommand } from '../command/session-command.js';
import type { SessionState } from '../model/session-state.js';
import { type SessionTransition, unchangedTransition } from './transition.js';
import { cancelTurn } from './turn/cancellation.js';
import { reducePromptOutcome } from './turn/completion.js';
import { reduceTurnEvent } from './turn/events.js';
import { rejectBusyTurn, startTurn } from './turn/start.js';
import { reduceProviderUpdate } from './turn/updates.js';

type TurnSessionState = Extract<SessionState, { readonly status: 'idle' | 'running' }>;
type EventOutcome = Extract<SessionCommand, { readonly type: `event.${string}` }>;
type PromptOutcome = Extract<SessionCommand, { readonly type: `provider.prompt.${string}` }>;

const isEventOutcome = (command: SessionCommand): command is EventOutcome =>
  command.type === 'event.applied' ||
  command.type === 'event.failed' ||
  command.type === 'event.timed_out_then_applied' ||
  command.type === 'event.timed_out_then_failed' ||
  command.type === 'event.unknown';

const isPromptOutcome = (command: SessionCommand): command is PromptOutcome =>
  command.type === 'provider.prompt.accepted' ||
  command.type === 'provider.prompt.completed' ||
  command.type === 'provider.prompt.failed' ||
  command.type === 'provider.prompt.rejected' ||
  command.type === 'provider.prompt.timed_out';

const providerUpdateTypes: ReadonlySet<SessionCommand['type']> = new Set([
  'provider.interaction_requested',
  'provider.message_completed',
  'provider.message_delta',
  'provider.plan',
  'provider.progress',
  'provider.tool',
  'provider.usage',
]);

const isProviderUpdate = (command: SessionCommand): command is ProviderCommand =>
  providerUpdateTypes.has(command.type);

export const reduceTurnSession = (
  state: TurnSessionState,
  command: SessionCommand,
): SessionTransition => {
  if (state.status === 'idle')
    return command.type === 'turn.send' ? startTurn(state, command) : unchangedTransition(state);
  if (command.type === 'turn.send') return rejectBusyTurn(state, command);
  if (command.type === 'turn.cancel') return cancelTurn(state, command);
  if (isEventOutcome(command)) return reduceTurnEvent(state, command);
  if (isPromptOutcome(command)) return reducePromptOutcome(state, command);
  if (isProviderUpdate(command)) return reduceProviderUpdate(state, command);
  return unchangedTransition(state);
};
