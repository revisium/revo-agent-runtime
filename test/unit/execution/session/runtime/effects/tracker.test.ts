import { expect, test } from 'vitest';

import { EffectTracker } from '../../../../../../src/execution/session/runtime/effects/tracker.js';

test('quiescence waits for every distinct effect and is reusable', async () => {
  const tracker = new EffectTracker();
  const observed: string[] = [];

  expect(tracker.begin('effect_01')).toBe(true);
  expect(tracker.begin('effect_01')).toBe(false);
  expect(tracker.begin('effect_02')).toBe(true);
  void tracker.whenIdle().then(() => observed.push('idle'));

  expect(tracker.finish('unknown')).toBe(false);
  expect(tracker.finish('effect_01')).toBe(true);
  await Promise.resolve();
  expect(observed).toEqual([]);

  expect(tracker.finish('effect_02')).toBe(true);
  await tracker.whenIdle();
  expect(observed).toEqual(['idle']);
  await expect(tracker.whenIdle()).resolves.toBeUndefined();
});
