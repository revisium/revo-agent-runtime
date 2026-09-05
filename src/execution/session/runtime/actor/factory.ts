import type { SessionState } from '../../kernel/model/session-state.js';
import type { SessionReducer } from '../../kernel/reducer/transition.js';
import { SessionEffectDispatcher } from '../effects/dispatcher.js';
import { systemSessionClock, type SessionClock } from '../timing/clock.js';
import { SessionActor } from './session-actor.js';

export interface SessionActorFactoryOptions {
  readonly reducer: SessionReducer;
  readonly dispatcher: SessionEffectDispatcher;
  readonly clock?: SessionClock;
}

export class SessionActorFactory {
  constructor(private readonly options: SessionActorFactoryOptions) {}

  create(initialState: SessionState): SessionActor {
    return new SessionActor({
      clock: this.options.clock ?? systemSessionClock,
      dispatcher: this.options.dispatcher,
      initialState,
      reducer: this.options.reducer,
    });
  }
}
