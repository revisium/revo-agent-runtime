import { expect, test } from 'vitest';

import type { SessionCommand } from '../../../../../../../src/execution/session/kernel/command/session-command.js';
import type { SessionEffect } from '../../../../../../../src/execution/session/kernel/effect/session-effect.js';
import type { TurnEffectCorrelation } from '../../../../../../../src/execution/session/kernel/model/identity.js';
import { reduceSession } from '../../../../../../../src/execution/session/kernel/reducer/reduce.js';
import type { SessionTransition } from '../../../../../../../src/execution/session/kernel/reducer/transition.js';
import { idleSessionState } from '../../../../../../support/session/builders/kernel/session-state.js';

const observed = { observedAt: '2026-03-21T00:00:02.000Z', observedAtMs: 2_000 } as const;
const fault = {
  code: 'revo.agent.timeout',
  message: 'operation timed out',
  phase: 'session_running',
  retryable: true,
} as const;
const effectOf = <Type extends SessionEffect['type']>(
  transition: SessionTransition,
  type: Type,
): Extract<SessionEffect, { readonly type: Type }> => {
  const effect = transition.effects.find(
    (candidate): candidate is Extract<SessionEffect, { readonly type: Type }> =>
      candidate.type === type,
  );
  if (effect === undefined) throw new Error(`Missing ${type} effect.`);
  return effect;
};

const promptingTurn = () => {
  const sent = reduceSession(idleSessionState(), {
    ...observed,
    call: { callId: 'send_01', epoch: 1, sessionId: 'session_01', turnId: 'turn_01' },
    input: { prompt: 'Continue', turnId: 'turn_01' },
    resultCallId: 'result_01',
    type: 'turn.send',
  });
  const append = effectOf(sent, 'event.append');
  const prompting = reduceSession(sent.state, {
    ...observed,
    correlation: append.correlation,
    result: { state: 'appended' },
    type: 'event.applied',
  });
  return { prompt: effectOf(prompting, 'provider.prompt'), state: prompting.state };
};

const settle = (command: (correlation: TurnEffectCorrelation) => SessionCommand) => {
  const { prompt, state } = promptingTurn();
  const settling = reduceSession(state, command(prompt.correlation));
  const append = effectOf(settling, 'event.append');
  return reduceSession(settling.state, {
    ...observed,
    correlation: append.correlation,
    result: { state: 'appended' },
    type: 'event.applied',
  });
};

test('provider operation failures resolve failed turns, including operation timeout', () => {
  for (const type of [
    'provider.prompt.rejected',
    'provider.prompt.failed',
    'provider.prompt.timed_out',
  ] as const) {
    const transition = settle((correlation) => ({ ...observed, correlation, fault, type }));
    expect(transition.state).toMatchObject({
      lastTurn: { result: { error: fault, status: 'failed' }, status: 'failed' },
      status: 'idle',
    });
  }
});

test('provider terminal outcomes preserve cancelled, interrupted, and timed-out results', () => {
  for (const status of ['cancelled', 'interrupted', 'timed_out'] as const) {
    const transition = settle((correlation) => ({
      ...observed,
      correlation,
      outcome: { status },
      type: 'provider.prompt.completed',
    }));
    expect(transition.state).toMatchObject({ lastTurn: { result: { status } }, status: 'idle' });
  }
});
