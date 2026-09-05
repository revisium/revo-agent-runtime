import { describe, expect, test } from 'vitest';

import type { PublicSessionCommand } from '../../../../../../src/execution/session/kernel/command/public.js';
import { createOpeningSessionState } from '../../../../../../src/execution/session/kernel/reducer/opening/state.js';
import type { SessionReducer } from '../../../../../../src/execution/session/kernel/reducer/transition.js';
import { SessionActor } from '../../../../../../src/execution/session/runtime/actor/session-actor.js';
import {
  SessionEffectDispatcher,
  type SessionEffectInterpreter,
} from '../../../../../../src/execution/session/runtime/effects/dispatcher.js';
import { MAILBOX_LIMITS } from '../../../../../../src/execution/session/runtime/mailbox/queue.js';
import type { SessionClock } from '../../../../../../src/execution/session/runtime/timing/clock.js';
import { sessionOpeningCommand } from '../../../../../support/session/builders/kernel/opening.js';
import { idleSessionState } from '../../../../../support/session/builders/kernel/session-state.js';

const observed = { observedAt: '2026-09-05T00:00:00.000Z', observedAtMs: 1_000 } as const;
const clock: SessionClock = {
  now: () => ({ iso: observed.observedAt, milliseconds: observed.observedAtMs }),
  schedule: () => ({ cancel: () => undefined }),
};

const checkpoint = (index: number): PublicSessionCommand => ({
  ...observed,
  call: { callId: `checkpoint_call_${index}`, epoch: 1, sessionId: 'session_01' },
  checkpointId: `checkpoint_${index}`,
  type: 'session.checkpoint',
});

const sendTurn = (): PublicSessionCommand => ({
  ...observed,
  call: {
    callId: 'turn_call_overflow',
    epoch: 1,
    sessionId: 'session_01',
    turnId: 'turn_overflow',
  },
  input: { prompt: 'overflow', turnId: 'turn_overflow' },
  resultCallId: 'turn_result_overflow',
  type: 'turn.send',
});

const cancel = (callId: string): PublicSessionCommand => ({
  ...observed,
  call: { callId, epoch: 1, sessionId: 'session_01' },
  type: 'session.cancel',
});

const seed: PublicSessionCommand = {
  ...observed,
  call: { callId: 'seed', epoch: 1, sessionId: 'session_01' },
  type: 'session.close',
};

describe('actor admission under saturation', () => {
  test('rejects excess ordinary work while coalesced terminal control and outcomes progress', async () => {
    const reducer: SessionReducer = (state, command) => {
      if (command.type === 'session.close' && command.call.callId === 'seed')
        return {
          effects: [
            {
              correlation: { effectId: 'prepare_01', epoch: 1, sessionId: 'session_01' },
              opening: sessionOpeningCommand().opening,
              timeoutMs: 100,
              type: 'opening.prepare',
            },
          ],
          state,
        };
      if (command.type === 'session.cancel')
        return {
          effects: [
            {
              callId: command.call.callId,
              correlation: {
                effectId: `resolve_${command.call.callId}`,
                epoch: 1,
                sessionId: 'session_01',
              },
              resolution: { kind: 'cancel_session', result: { state: 'requested' } },
              type: 'public.resolve',
            },
          ],
          state,
        };
      return { effects: [], state };
    };

    let actor: SessionActor;
    let acceptedOrdinary = 0;
    let overflowResult: ReturnType<SessionActor['dispatch']> | undefined;
    let overflowCall: ReturnType<SessionActor['registerCall']> | undefined;
    let overflowResultCall: ReturnType<SessionActor['registerCall']> | undefined;
    let leaderResult: ReturnType<SessionActor['dispatch']> | undefined;
    let followerResult: ReturnType<SessionActor['dispatch']> | undefined;
    const interpreter = {
      execute: (effect, output) => {
        for (let index = 0; index < MAILBOX_LIMITS.ordinary; index += 1)
          if (actor.dispatch(checkpoint(index)).state === 'accepted') acceptedOrdinary += 1;
        overflowCall = actor.registerCall('turn_call_overflow');
        overflowResultCall = actor.registerCall('turn_result_overflow');
        overflowResult = actor.dispatch(sendTurn());
        leaderResult = actor.dispatch(cancel('cancel_leader'));
        followerResult = actor.dispatch(cancel('cancel_follower'));
        output.outcome({
          ...observed,
          correlation: effect.correlation,
          preparationId: 'preparation_01',
          type: 'opening.preparation.succeeded',
        });
      },
      type: 'opening.prepare',
    } satisfies SessionEffectInterpreter;
    actor = new SessionActor({
      clock,
      dispatcher: new SessionEffectDispatcher([interpreter]),
      initialState: idleSessionState(),
      reducer,
    });
    const leaderCall = actor.registerCall('cancel_leader');
    const followerCall = actor.registerCall('cancel_follower');

    actor.dispatch(seed);
    await actor.whenQuiescent();

    expect(acceptedOrdinary).toBe(MAILBOX_LIMITS.ordinary);
    expect(overflowResult).toMatchObject({
      fault: { code: 'revo.agent.session_backpressure', retryable: true },
      state: 'rejected',
    });
    await expect(overflowCall).resolves.toMatchObject({
      fault: { code: 'revo.agent.session_backpressure' },
      state: 'rejected',
    });
    await expect(overflowResultCall).resolves.toMatchObject({
      fault: { code: 'revo.agent.session_backpressure' },
      state: 'rejected',
    });
    expect(leaderResult).toEqual({ state: 'accepted' });
    expect(followerResult).toEqual({ state: 'coalesced' });
    await expect(leaderCall).resolves.toMatchObject({ state: 'resolved' });
    await expect(followerCall).resolves.toMatchObject({ state: 'resolved' });
    expect(actor.activeEffects).toBe(0);
  });

  test('reports opening-phase backpressure while an opening actor is saturated', async () => {
    const reducer: SessionReducer = (state, command) =>
      command.type === 'session.close' && command.call.callId === 'seed'
        ? {
            effects: [
              {
                correlation: { effectId: 'prepare_opening', epoch: 1, sessionId: 'session_01' },
                opening: sessionOpeningCommand().opening,
                timeoutMs: 100,
                type: 'opening.prepare',
              },
            ],
            state,
          }
        : { effects: [], state };
    let actor: SessionActor;
    let overflow: ReturnType<SessionActor['dispatch']> | undefined;
    const interpreter = {
      execute: (effect, output) => {
        for (let index = 0; index < MAILBOX_LIMITS.ordinary; index += 1)
          actor.dispatch(checkpoint(index));
        overflow = actor.dispatch(checkpoint(999));
        output.outcome({
          ...observed,
          correlation: effect.correlation,
          preparationId: 'preparation_01',
          type: 'opening.preparation.succeeded',
        });
      },
      type: 'opening.prepare',
    } satisfies SessionEffectInterpreter;
    actor = new SessionActor({
      clock,
      dispatcher: new SessionEffectDispatcher([interpreter]),
      initialState: createOpeningSessionState(sessionOpeningCommand()),
      reducer,
    });

    actor.dispatch(seed);
    await actor.whenQuiescent();

    expect(overflow).toMatchObject({
      fault: { phase: 'session_opening' },
      state: 'rejected',
    });
  });
});
