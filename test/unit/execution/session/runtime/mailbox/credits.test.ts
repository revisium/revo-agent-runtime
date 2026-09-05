import { describe, expect, test } from 'vitest';

import type { EffectOutcomeCommand } from '../../../../../../src/execution/session/kernel/command/effect.js';
import type { SessionEffect } from '../../../../../../src/execution/session/kernel/effect/session-effect.js';
import {
  commandAdmission,
  isEffectOutcomeCommand,
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

  test.each([
    'opening.prepare',
    'process.start',
    'provider.open',
    'provider.prompt',
    'provider.interaction.respond',
    'event.append',
    'persistence.save',
    'persistence.remove',
    'checkpoint.capture',
    'output.publish',
    'process.cleanup',
  ] as const)('%s consumes outcome credit', (type) => {
    expect(
      requiresOutcomeCredit({ correlation: effect('x').correlation, type } as SessionEffect),
    ).toBe(true);
  });

  test.each([
    'provider.turn.cancel',
    'provider.close',
    'timer.schedule',
    'timer.cancel',
    'public.resolve',
    'public.reject',
  ] as const)('%s does not consume outcome credit', (type) => {
    expect(
      requiresOutcomeCredit({ correlation: effect('x').correlation, type } as SessionEffect),
    ).toBe(false);
  });

  test('classifies mailbox command lanes and coalescing keys', () => {
    const call = { call: { callId: 'call', epoch: 1, sessionId: 'session_01' } };
    expect(commandAdmission({ ...call, type: 'session.cancel' } as never)).toEqual({
      key: 'cancel',
      lane: 'control',
    });
    expect(commandAdmission({ ...call, type: 'session.close' } as never)).toEqual({
      key: 'close',
      lane: 'control',
    });
    expect(commandAdmission({ ...call, type: 'manager.shutdown' } as never)).toEqual({
      key: 'shutdown',
      lane: 'control',
    });
    expect(commandAdmission({ ...call, type: 'session.send' } as never)).toEqual({
      lane: 'ordinary',
    });
    const provider = {
      content: 'delta',
      correlation: { effectId: 'update', epoch: 1, sessionId: 'session_01', turnId: 'turn' },
      observedAt: '2026-09-05T00:00:00.000Z',
      observedAtMs: 1_000,
      type: 'provider.message_delta',
    } as const;
    expect(commandAdmission(provider)).toEqual({ lane: 'provider_update' });
    expect(isEffectOutcomeCommand(provider)).toBe(false);
    expect(commandAdmission({ ...provider, type: 'timer.fired' } as never)).toEqual({
      lane: 'reserved',
    });
    expect(isEffectOutcomeCommand({ ...provider, type: 'timer.fired' } as never)).toBe(false);
    expect(commandAdmission(failed('outcome'))).toEqual({ lane: 'reserved' });
    expect(isEffectOutcomeCommand(failed('outcome'))).toBe(true);
    expect(isEffectOutcomeCommand({ ...call, type: 'session.send' } as never)).toBe(false);
  });

  test('rejects duplicate effect ids both within and across reservations', () => {
    const credits = new OutcomeCreditLedger();
    expect(credits.has('same')).toBe(false);
    expect(credits.reserve([effect('same'), effect('same')])).toBe(false);
    expect(credits.reserve([effect('same')])).toBe(true);
    expect(credits.has('same')).toBe(true);
    expect(credits.reserve([effect('same')])).toBe(false);
  });

  test.each([
    ['process.start', 'process.started'],
    ['process.start', 'process.failed'],
    ['process.start', 'process.timed_out'],
    ['provider.open', 'provider.opened'],
    ['provider.prompt', 'provider.prompt.completed'],
    ['provider.interaction.respond', 'provider.interaction.accepted'],
    ['event.append', 'event.applied'],
    ['persistence.save', 'persistence.applied'],
    ['persistence.remove', 'persistence.unknown'],
    ['checkpoint.capture', 'checkpoint.captured'],
    ['process.cleanup', 'process.cleanup.confirmed'],
    ['output.publish', 'output.published'],
  ] as const)('releases %s credit for %s family', (effectType, outcomeType) => {
    const credits = new OutcomeCreditLedger();
    const correlation = {
      effectId: 'effect',
      epoch: 1,
      sessionId: 'session_01',
      ...(effectType === 'provider.prompt' ? { turnId: 'turn' } : {}),
    };
    credits.reserve([{ correlation, type: effectType } as SessionEffect]);
    expect(credits.release({ correlation, type: outcomeType } as EffectOutcomeCommand)).toBe(true);
  });

  test('keeps prompt acceptance credit and rejects every correlation mismatch', () => {
    const credits = new OutcomeCreditLedger();
    const correlation = { effectId: 'prompt', epoch: 1, sessionId: 'session_01', turnId: 'turn' };
    credits.reserve([{ correlation, type: 'provider.prompt' } as SessionEffect]);
    expect(
      credits.release({ correlation, type: 'provider.prompt.accepted' } as EffectOutcomeCommand),
    ).toBe(false);
    for (const changed of [
      { ...correlation, effectId: 'other' },
      { ...correlation, sessionId: 'other' },
      { ...correlation, epoch: 2 },
      { ...correlation, turnId: 'other' },
    ])
      expect(
        credits.release({
          correlation: changed,
          type: 'provider.prompt.completed',
        } as EffectOutcomeCommand),
      ).toBe(false);
    expect(
      credits.release({ correlation, type: 'provider.prompt.completed' } as EffectOutcomeCommand),
    ).toBe(true);
  });
});
