import type { SessionCommand } from '../command/session-command.js';
import type { SessionState } from '../model/session-state.js';
import { reduceCheckpointSession } from './checkpoint.js';
import { reduceInteractionSession } from './interaction.js';
import { reduceOpeningSession } from './opening.js';
import { reduceActiveTerminal, reduceTerminalizing } from './terminal.js';
import {
  appendEffect,
  nextEffectCorrelation,
  type SessionReducer,
  unchangedTransition,
} from './transition.js';
import { reduceTurnSession } from './turn.js';

const belongsToSession = (state: SessionState, command: SessionCommand): boolean => {
  if ('call' in command)
    return command.call.sessionId === state.sessionId && command.call.epoch === state.epoch;
  return (
    command.correlation.sessionId === state.sessionId && command.correlation.epoch === state.epoch
  );
};

export const reduceSession: SessionReducer = (state: SessionState, command: SessionCommand) => {
  if (!belongsToSession(state, command)) return unchangedTransition(state);
  if (command.type === 'process.late_started') {
    const correlation = nextEffectCorrelation(state);
    return appendEffect(unchangedTransition(state), {
      correlation,
      process: command.process,
      processResourceId: command.processResourceId,
      reason: 'Late session process ownership was not admitted.',
      timeoutMs: state.limits.operationTimeoutMs,
      type: 'process.cleanup',
    });
  }
  if (state.status === 'closing' || state.status === 'cancelling')
    return reduceTerminalizing(state, command);
  const checkpoint = reduceCheckpointSession(state, command);
  if (checkpoint !== undefined) return checkpoint;
  if (state.status === 'opening' || state.status === 'idle' || state.status === 'running') {
    const interaction = reduceInteractionSession(state, command);
    if (interaction !== undefined) return interaction;
  }
  if (state.status === 'opening') return reduceOpeningSession(state, command);
  if (
    (state.status === 'idle' || state.status === 'running') &&
    (command.type === 'session.close' ||
      command.type === 'session.cancel' ||
      command.type === 'timer.fired')
  )
    return reduceActiveTerminal(state, command);
  if (state.status === 'idle' || state.status === 'running')
    return reduceTurnSession(state, command);
  return unchangedTransition(state);
};
