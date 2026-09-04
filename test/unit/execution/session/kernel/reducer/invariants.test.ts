import { expect, test } from 'vitest';

import type { SessionCommand } from '../../../../../../src/execution/session/kernel/command/session-command.js';
import type { SessionEffect } from '../../../../../../src/execution/session/kernel/effect/session-effect.js';
import type { SessionState } from '../../../../../../src/execution/session/kernel/model/session-state.js';
import { reduceSession } from '../../../../../../src/execution/session/kernel/reducer/reduce.js';
import { idleSessionState } from '../../../../../support/session/builders/kernel/session-state.js';

const observed = { observedAt: '2026-03-21T00:00:02.000Z', observedAtMs: 2_000 } as const;
const correlation = {
  effectId: 'stale_effect',
  epoch: 1,
  sessionId: 'session_01',
  turnId: 'turn_01',
} as const;

const commands = [
  {
    ...observed,
    call: { callId: 'send_01', epoch: 1, sessionId: 'session_01', turnId: 'turn_01' },
    input: { prompt: 'Continue', turnId: 'turn_01' },
    resultCallId: 'result_01',
    type: 'turn.send',
  },
  {
    ...observed,
    call: { callId: 'close_01', epoch: 1, sessionId: 'session_01' },
    type: 'session.close',
  },
  {
    ...observed,
    call: { callId: 'cancel_01', epoch: 1, sessionId: 'session_01' },
    type: 'session.cancel',
  },
  {
    ...observed,
    content: 'stale',
    correlation,
    type: 'provider.message_delta',
  },
  {
    ...observed,
    correlation,
    fault: {
      code: 'revo.agent.event_sink_failed',
      message: 'unknown',
      phase: 'session_delivery',
      retryable: true,
    },
    type: 'event.unknown',
  },
] satisfies readonly SessionCommand[];

const permutations = <Value>(values: readonly Value[]): readonly (readonly Value[])[] => {
  if (values.length < 2) return [values];
  return values.flatMap((value, index) =>
    permutations(values.filter((_, candidate) => candidate !== index)).map((tail) => [
      value,
      ...tail,
    ]),
  );
};

const terminalStatuses: ReadonlySet<SessionState['status']> = new Set([
  'cancelled',
  'closed',
  'failed',
  'hibernated',
  'timed_out',
]);
const cleanupEffects: ReadonlySet<SessionEffect['type']> = new Set([
  'process.cleanup',
  'persistence.remove',
  'provider.close',
  'timer.cancel',
]);

test('generated command permutations preserve reducer invariants', () => {
  for (const sequence of permutations(commands)) {
    let state: SessionState = idleSessionState();
    let terminalTransitions = 0;
    const terminalTurns = new Set<string>();
    for (const command of sequence) {
      const previous = state;
      const transition = reduceSession(state, command);
      expect(transition.state.nextEffectSequence).toBeGreaterThanOrEqual(
        previous.nextEffectSequence,
      );
      expect(transition.state.nextEventSequence).toBeGreaterThanOrEqual(previous.nextEventSequence);
      if (!terminalStatuses.has(previous.status) && terminalStatuses.has(transition.state.status))
        terminalTransitions += 1;
      if ('lastTurn' in transition.state && transition.state.lastTurn !== undefined)
        terminalTurns.add(transition.state.lastTurn.turnId);
      if (terminalStatuses.has(previous.status))
        expect(transition.effects.every(({ type }) => cleanupEffects.has(type))).toBe(true);
      state = transition.state;
    }
    expect(terminalTransitions).toBeLessThanOrEqual(1);
    expect(terminalTurns.size).toBeLessThanOrEqual(1);
  }
});
