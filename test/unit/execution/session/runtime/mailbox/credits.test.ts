import { describe, expect, test } from 'vitest';

import type { EffectOutcomeCommand } from '../../../../../../src/execution/session/kernel/command/effect.js';
import type { SessionEffect } from '../../../../../../src/execution/session/kernel/effect/session-effect.js';
import {
  MAX_CONCURRENT_EFFECTS,
  OutcomeCreditLedger,
  requiresOutcomeCredit,
} from '../../../../../../src/execution/session/runtime/mailbox/credits.js';
import { sessionOpeningCommand } from '../../../../../support/session/builders/kernel/opening.js';

const effect = (effectId: string): SessionEffect => ({
  correlation: { effectId, epoch: 1, sessionId: 'session_01' },
  opening: sessionOpeningCommand().opening,
  timeoutMs: 100,
  type: 'opening.prepare',
});
const failed = (
  effectId: string,
): Extract<EffectOutcomeCommand, { readonly type: 'opening.preparation.failed' }> => ({
  correlation: { effectId, epoch: 1, sessionId: 'session_01' },
  fault: {
    code: 'revo.agent.protocol_failed',
    message: 'failed',
    phase: 'session_opening',
    retryable: false,
  },
  observedAt: '2026-09-05T00:00:00.000Z',
  observedAtMs: 1_000,
  type: 'opening.preparation.failed',
});

describe('outcome credit ledger', () => {
  test('reserves a transition atomically and releases by effect correlation', () => {
    const credits = new OutcomeCreditLedger();

    expect(credits.reserve([effect('effect_01'), effect('effect_02')])).toBe(true);
    expect(credits.size).toBe(2);
    expect(credits.release(failed('effect_01'))).toBe(true);
    expect(credits.release(failed('effect_01'))).toBe(false);
    expect(credits.size).toBe(1);
  });

  test('does not release on a mismatched family or correlation identity', () => {
    const credits = new OutcomeCreditLedger();
    credits.reserve([effect('effect_01')]);
    const openingFailure = failed('effect_01');

    expect(
      credits.release({
        correlation: openingFailure.correlation,
        fault: openingFailure.fault,
        observedAt: openingFailure.observedAt,
        observedAtMs: openingFailure.observedAtMs,
        type: 'provider.open_failed',
      }),
    ).toBe(false);
    expect(
      credits.release({
        correlation: { effectId: 'effect_01', epoch: 2, sessionId: 'session_01' },
        fault: openingFailure.fault,
        observedAt: openingFailure.observedAt,
        observedAtMs: openingFailure.observedAtMs,
        type: 'opening.preparation.failed',
      }),
    ).toBe(false);
    expect(credits.size).toBe(1);
  });

  test('does not partially reserve a transition that exceeds the fixed budget', () => {
    const credits = new OutcomeCreditLedger();
    const fullBudget = Array.from({ length: MAX_CONCURRENT_EFFECTS }, (_, index) =>
      effect(`effect_${index}`),
    );

    expect(credits.reserve(fullBudget)).toBe(true);
    expect(credits.reserve([effect('overflow')])).toBe(false);
    expect(credits.size).toBe(MAX_CONCURRENT_EFFECTS);
  });

  test('only external effects with mandatory outcomes consume credits', () => {
    expect(requiresOutcomeCredit(effect('effect_01'))).toBe(true);
    expect(
      requiresOutcomeCredit({
        callId: 'call_01',
        correlation: { effectId: 'effect_02', epoch: 1, sessionId: 'session_01' },
        resolution: { kind: 'session_ready' },
        type: 'public.resolve',
      }),
    ).toBe(false);
    expect(
      requiresOutcomeCredit({
        correlation: { effectId: 'effect_03', epoch: 1, sessionId: 'session_01' },
        timer: {
          deadlineMs: 100,
          generation: 1,
          kind: 'idle',
          timerId: 'idle',
        },
        type: 'timer.schedule',
      }),
    ).toBe(false);
  });
});
