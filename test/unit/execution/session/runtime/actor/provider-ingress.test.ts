import { expect, test } from 'vitest';

import type { PublicSessionCommand } from '../../../../../../src/execution/session/kernel/command/public.js';
import type { SessionReducer } from '../../../../../../src/execution/session/kernel/reducer/transition.js';
import { SessionActor } from '../../../../../../src/execution/session/runtime/actor/session-actor.js';
import {
  SessionEffectDispatcher,
  type SessionEffectInterpreter,
} from '../../../../../../src/execution/session/runtime/effects/dispatcher.js';
import { MAILBOX_LIMITS } from '../../../../../../src/execution/session/runtime/mailbox/queue.js';
import type { SessionClock } from '../../../../../../src/execution/session/runtime/timing/clock.js';
import { idleSessionState } from '../../../../../support/session/builders/kernel/session-state.js';

const observed = { observedAt: '2026-09-05T00:00:00.000Z', observedAtMs: 1_000 } as const;
const correlation = {
  effectId: 'prompt_01',
  epoch: 1,
  sessionId: 'session_01',
  turnId: 'turn_01',
} as const;
const clock: SessionClock = {
  now: () => ({ iso: observed.observedAt, milliseconds: observed.observedAtMs }),
  schedule: () => ({ cancel: () => undefined }),
};
const seed: PublicSessionCommand = {
  ...observed,
  call: { callId: 'seed', epoch: 1, sessionId: 'session_01' },
  type: 'session.close',
};

test('bounds non-cooperative ingress and returns a fail-closed prompt outcome', async () => {
  const commands: string[] = [];
  const admissions: string[] = [];
  const reducer: SessionReducer = (state, command) => {
    commands.push(command.type);
    if (command.type !== 'session.close') return { effects: [], state };
    return {
      effects: [
        {
          correlation,
          input: { prompt: 'stream', turnId: 'turn_01' },
          providerResourceId: 'provider_01',
          timeoutMs: 100,
          type: 'provider.prompt',
        },
      ],
      state,
    };
  };
  const prompt = {
    execute: (effect, output) => {
      if (effect.type !== 'provider.prompt') throw new Error('Expected provider prompt.');
      for (let index = 0; index <= MAILBOX_LIMITS.providerUpdates; index += 1)
        admissions.push(
          output.offerUpdate({
            ...observed,
            content: String(index),
            correlation: effect.correlation,
            type: 'provider.message_delta',
          }),
        );
    },
    type: 'provider.prompt',
  } satisfies SessionEffectInterpreter;
  const actor = new SessionActor({
    clock,
    dispatcher: new SessionEffectDispatcher([prompt]),
    initialState: idleSessionState(),
    reducer,
  });

  actor.dispatch(seed);
  await actor.whenQuiescent();

  expect(admissions.filter((value) => value === 'accepted')).toHaveLength(
    MAILBOX_LIMITS.providerUpdates,
  );
  expect(admissions.at(-1)).toBe('overflow');
  expect(commands.filter((type) => type === 'provider.message_delta')).toHaveLength(
    MAILBOX_LIMITS.providerUpdates,
  );
  expect(commands.at(-1)).toBe('provider.prompt.failed');
  expect(actor.activeEffects).toBe(0);
});
