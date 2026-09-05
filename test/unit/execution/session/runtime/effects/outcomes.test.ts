import { expect, test } from 'vitest';

import type { EffectOutcomeCommand } from '../../../../../../src/execution/session/kernel/command/effect.js';
import { isTerminalEffectOutcome } from '../../../../../../src/execution/session/runtime/effects/router.js';

const correlation = {
  effectId: 'prompt_01',
  epoch: 1,
  sessionId: 'session_01',
  turnId: 'turn_01',
} as const;
const observed = { observedAt: '2026-09-05T00:00:00.000Z', observedAtMs: 1_000 } as const;

test('prompt acceptance keeps its effect lease until a terminal outcome', () => {
  const accepted = {
    ...observed,
    correlation,
    type: 'provider.prompt.accepted',
  } satisfies EffectOutcomeCommand;
  const completed = {
    ...observed,
    correlation,
    outcome: { status: 'cancelled' },
    type: 'provider.prompt.completed',
  } satisfies EffectOutcomeCommand;

  expect(isTerminalEffectOutcome(accepted)).toBe(false);
  expect(isTerminalEffectOutcome(completed)).toBe(true);
});
