import type { SessionState } from '../../kernel/model/session-state.js';
import { createOpeningSessionState } from '../../kernel/reducer/opening/state.js';
import type { SessionReducer } from '../../kernel/reducer/transition.js';
import { SessionEffectDispatcher } from '../effects/dispatcher.js';
import { systemSessionClock, type SessionClock } from '../timing/clock.js';
import type { SessionOpeningCommand, SessionRuntimeFactory } from './port.js';
import { SessionActor } from './session-actor.js';

export interface SessionActorFactoryOptions {
  readonly release?: (session: { readonly sessionId: string; readonly epoch: number }) => void;
  readonly reducer: SessionReducer;
  readonly dispatcher: SessionEffectDispatcher;
  readonly clock?: SessionClock;
}

export class SessionActorFactory implements SessionRuntimeFactory {
  constructor(private readonly options: SessionActorFactoryOptions) {}

  create(initialState: SessionState): SessionActor {
    return new SessionActor({
      ...(this.options.release === undefined ? {} : { release: this.options.release }),
      clock: this.options.clock ?? systemSessionClock,
      dispatcher: this.options.dispatcher,
      initialState,
      reducer: this.options.reducer,
    });
  }

  createOpening(command: SessionOpeningCommand): SessionActor {
    return this.create(createOpeningSessionState(command));
  }
}
