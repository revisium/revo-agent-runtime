import type { SessionCommand } from '../command/session-command.js';
import type { SessionEffect } from '../effect/session-effect.js';
import type { SessionState } from '../model/session-state.js';

export interface SessionTransition {
  readonly state: SessionState;
  readonly effects: readonly SessionEffect[];
}

export type SessionReducer = (state: SessionState, command: SessionCommand) => SessionTransition;
