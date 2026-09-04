import type { AgentSessionEvent } from '../../../../contracts/session/events/event.js';
import type { AgentSessionEventAppendPrecondition } from '../../../../contracts/session/events/sink.js';
import type { SessionCommand } from '../command/session-command.js';
import type { SessionEffect } from '../effect/session-effect.js';
import type { EffectCorrelation, TurnEffectCorrelation } from '../model/identity.js';
import type { SessionState } from '../model/session-state.js';

export interface SessionTransition<State extends SessionState = SessionState> {
  readonly state: State;
  readonly effects: readonly SessionEffect[];
}

export type SessionReducer = (state: SessionState, command: SessionCommand) => SessionTransition;

export const unchangedTransition = <State extends SessionState>(
  state: State,
): SessionTransition<State> => ({
  effects: [],
  state,
});

export const nextSessionEventId = (state: SessionState): string =>
  `${state.sessionId}:${state.epoch}:event:${state.nextEventSequence}`;

export function nextEffectCorrelation(state: SessionState, turnId: string): TurnEffectCorrelation;
export function nextEffectCorrelation(state: SessionState): EffectCorrelation;
export function nextEffectCorrelation(state: SessionState, turnId?: string): EffectCorrelation {
  return {
    effectId: `${state.sessionId}:${state.epoch}:effect:${state.nextEffectSequence}`,
    epoch: state.epoch,
    sessionId: state.sessionId,
    ...(turnId === undefined ? {} : { turnId }),
  };
}

export const appendEffect = <State extends SessionState>(
  transition: SessionTransition<State>,
  effect: SessionEffect,
): SessionTransition<State> => ({
  effects: [...transition.effects, effect],
  state: {
    ...transition.state,
    nextEffectSequence: transition.state.nextEffectSequence + 1,
  },
});

const eventCursor = (event: AgentSessionEvent) => ({
  eventId: event.eventId,
  sequence: event.sequence,
  streamId: event.streamId,
});

const defaultPrecondition = (state: SessionState): AgentSessionEventAppendPrecondition =>
  state.events.cursor === undefined
    ? { kind: 'empty' }
    : { cursor: state.events.cursor, kind: 'cursor' };

export const queueSessionEvent = <State extends SessionState>(
  state: State,
  event: AgentSessionEvent,
  expected: AgentSessionEventAppendPrecondition = defaultPrecondition(state),
): SessionTransition<State> => {
  const nextState = { ...state, nextEventSequence: state.nextEventSequence + 1 };
  if (state.events.inFlight !== undefined)
    return {
      effects: [],
      state: {
        ...nextState,
        events: { ...state.events, pending: [...state.events.pending, event] },
      },
    };
  const correlation = nextEffectCorrelation(state);
  return appendEffect(
    {
      effects: [],
      state: {
        ...nextState,
        events: { ...state.events, inFlight: { correlation, event } },
      },
    },
    {
      correlation,
      event,
      expected,
      timeoutMs: state.limits.eventSinkTimeoutMs,
      type: 'event.append',
    },
  );
};

export interface EventAcknowledgement<State extends SessionState = SessionState> {
  readonly event: AgentSessionEvent;
  readonly transition: SessionTransition<State>;
}

export const acknowledgeSessionEvent = <State extends SessionState>(
  state: State,
  correlation: EffectCorrelation,
): EventAcknowledgement<State> | undefined => {
  const inFlight = state.events.inFlight;
  if (inFlight === undefined || inFlight.correlation.effectId !== correlation.effectId)
    return undefined;
  const cursor = eventCursor(inFlight.event);
  const [next, ...remaining] = state.events.pending;
  if (next === undefined)
    return {
      event: inFlight.event,
      transition: unchangedTransition({ ...state, events: { cursor, pending: [] } }),
    };
  const nextCorrelation = nextEffectCorrelation(state);
  return {
    event: inFlight.event,
    transition: appendEffect(
      {
        effects: [],
        state: {
          ...state,
          events: {
            cursor,
            inFlight: { correlation: nextCorrelation, event: next },
            pending: remaining,
          },
        },
      },
      {
        correlation: nextCorrelation,
        event: next,
        expected: { cursor, kind: 'cursor' },
        timeoutMs: state.limits.eventSinkTimeoutMs,
        type: 'event.append',
      },
    ),
  };
};
