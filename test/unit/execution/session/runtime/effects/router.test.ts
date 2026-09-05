import { expect, test, vi } from 'vitest';

import type {
  SessionEffect,
  SessionProviderUpdate,
} from '../../../../../../src/execution/session/kernel/effect/session-effect.js';
import type { ProviderUpdateCompletion } from '../../../../../../src/execution/session/runtime/effects/outcomes.js';
import {
  failedEffectOutcome,
  SessionEffectOutputController,
} from '../../../../../../src/execution/session/runtime/effects/router.js';

const clock = {
  now: () => ({ iso: '2026-09-05T00:00:00.000Z', milliseconds: 1_000 }),
  schedule: () => ({ cancel: () => undefined }),
};
const update = (effectId: string, turnId?: string): SessionProviderUpdate =>
  ({
    content: 'delta',
    correlation: {
      effectId,
      epoch: 1,
      sessionId: 'session_01',
      ...(turnId === undefined ? {} : { turnId }),
    },
    observedAt: '2026-09-05T00:00:00.000Z',
    observedAtMs: 1_000,
    type: 'provider.message_delta',
  }) as unknown as SessionProviderUpdate;

test('routes outcomes and completes accepted updates exactly once', async () => {
  const completions: ((value: ProviderUpdateCompletion) => void)[] = [];
  const enqueued: unknown[] = [];
  const enqueue = vi.fn(
    (command: unknown, complete?: (value: ProviderUpdateCompletion) => void) => {
      enqueued.push(command);
      if (complete !== undefined) completions.push(complete);
      return 'accepted' as const;
    },
  );
  const controller = new SessionEffectOutputController(clock, enqueue, 2);
  const outcome = {
    correlation: { effectId: 'open', epoch: 1, sessionId: 'session_01' },
    observedAt: clock.now().iso,
    observedAtMs: 1_000,
    type: 'provider.open_failed',
  } as Parameters<typeof controller.outcome>[0];
  controller.outcome(outcome);
  const pending = controller.update(update('update', 'turn'));
  expect(enqueued).toEqual([outcome, update('update', 'turn')]);
  completions[0]?.('processed');
  await expect(pending).resolves.toBe('processed');
  expect(controller.blockedUpdates).toBe(0);
});

test('fails closed on duplicate rolling updates and rejected queue admission', async () => {
  let completion: ((value: ProviderUpdateCompletion) => void) | undefined;
  const commands: unknown[] = [];
  const controller = new SessionEffectOutputController(
    clock,
    (command, complete) => {
      commands.push(command);
      if (complete !== undefined && completion === undefined) {
        completion = complete;
        return 'accepted';
      }
      return 'rejected';
    },
    2,
  );
  const first = controller.update(update('same', 'turn'));
  await expect(controller.update(update('same', 'turn'))).resolves.toBe('stale');
  const rejected = controller.update(update('rejected'));
  await expect(rejected).resolves.toBe('stale');
  expect(commands).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: 'provider.prompt.failed' }),
      expect.objectContaining({ type: 'provider.open_failed' }),
    ]),
  );
  completion?.('processed');
  await expect(first).resolves.toBe('processed');
});

test('offers best-effort updates and reports overflow without creating completion credit', () => {
  const accepted = new SessionEffectOutputController(clock, () => 'accepted', 1);
  expect(accepted.offerUpdate(update('accepted', 'turn'))).toBe('accepted');

  const commands: unknown[] = [];
  const rejected = new SessionEffectOutputController(
    clock,
    (command) => {
      commands.push(command);
      return 'rejected';
    },
    1,
  );
  expect(rejected.offerUpdate(update('rejected', 'turn'))).toBe('overflow');
  expect(commands.at(-1)).toMatchObject({ type: 'provider.prompt.failed' });
});

test('holds processed updates at the event limit and releases them below the limit', async () => {
  const controller = new SessionEffectOutputController(clock, () => 'accepted', 2);
  const resolved: ProviderUpdateCompletion[] = [];
  const complete = (value: ProviderUpdateCompletion) => resolved.push(value);

  controller.completeUpdate(undefined, 'processed', 2);
  controller.completeUpdate(complete, 'processed', 2);
  expect(controller.blockedUpdates).toBe(1);
  controller.releaseBlocked(2);
  expect(resolved).toEqual([]);
  controller.releaseBlocked(1);
  expect(resolved).toEqual(['processed']);
  expect(controller.blockedUpdates).toBe(0);
  controller.completeUpdate(complete, 'stale', 2);
  controller.completeUpdate(complete, 'processed', 1);
  expect(resolved).toEqual(['processed', 'stale', 'processed']);
});

test.each([
  ['opening.prepare', 'opening.preparation.failed'],
  ['process.start', 'process.failed'],
  ['provider.open', 'provider.open_failed'],
  ['provider.prompt', 'provider.prompt.failed'],
  ['provider.interaction.respond', 'provider.interaction.failed'],
  ['event.append', 'event.failed'],
  ['persistence.save', 'persistence.unknown'],
  ['persistence.remove', 'persistence.unknown'],
  ['checkpoint.capture', 'checkpoint.failed'],
  ['process.cleanup', 'process.cleanup.uncertain'],
  ['output.publish', 'output.uncertain'],
] as const)('maps failed %s effects to %s', (type, expected) => {
  const correlation = {
    effectId: 'effect',
    epoch: 1,
    sessionId: 'session_01',
    ...(type === 'provider.prompt' ? { turnId: 'turn_01' } : {}),
  };
  const effect = {
    correlation,
    outputDirectory: '/output',
    type,
  } as unknown as SessionEffect;
  const outcome = failedEffectOutcome(effect, clock.now(), {
    code: 'revo.agent.internal',
    message: 'failure',
    phase: 'session_running',
    retryable: false,
  });
  expect(outcome).toMatchObject({ correlation, type: expected });
  if (type === 'output.publish')
    expect(outcome).toMatchObject({
      output: { files: { directory: '/output' }, state: 'uncertain' },
    });
});

test.each([
  'provider.turn.cancel',
  'provider.close',
  'timer.schedule',
  'timer.cancel',
  'public.resolve',
  'public.reject',
] as const)('does not synthesize failure outcomes for %s', (type) => {
  expect(
    failedEffectOutcome(
      {
        correlation: { effectId: 'effect', epoch: 1, sessionId: 'session_01' },
        type,
      } as unknown as SessionEffect,
      clock.now(),
      {
        code: 'revo.agent.internal',
        message: 'failure',
        phase: 'session_running',
        retryable: false,
      },
    ),
  ).toBeUndefined();
});
