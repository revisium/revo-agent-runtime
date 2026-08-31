import { expect, test } from 'vitest';

import { invocationLimits } from '../../../../src/application/manager/limits.js';
import { validateManagerOptions } from '../../../../src/application/manager/options.js';
import { agentDefinition } from '../../../support/builders/agent-definition.js';
import { noOpActiveStateSink } from '../../../support/stories/active-state.js';

test('invocation deadlines reject a non-object override', () => {
  expect(() =>
    invocationLimits(30, { idleTimeoutMs: 300_000, wallClockTimeoutMs: 1_800_000 }),
  ).toThrow('Agent invocation limit is invalid.');
});

test('applies the exact active-state and initialization deadline policy', () => {
  const options = {
    activeStateSink: noOpActiveStateSink,
    definitions: [agentDefinition()],
  };

  expect(validateManagerOptions(options).limits).toMatchObject({
    activeStateOperationTimeoutMs: 10_000,
    initializationTimeoutMs: 120_000,
  });
  expect(
    validateManagerOptions({
      ...options,
      limits: { activeStateOperationTimeoutMs: 100, initializationTimeoutMs: 1_000 },
    }).limits,
  ).toMatchObject({ activeStateOperationTimeoutMs: 100, initializationTimeoutMs: 1_000 });
  expect(
    validateManagerOptions({
      ...options,
      limits: {
        activeStateOperationTimeoutMs: 30_000,
        initializationTimeoutMs: 1_800_000,
      },
    }).limits,
  ).toMatchObject({
    activeStateOperationTimeoutMs: 30_000,
    initializationTimeoutMs: 1_800_000,
  });
  expect(() =>
    validateManagerOptions({ ...options, limits: { activeStateOperationTimeoutMs: 99 } }),
  ).toThrow('Agent manager limit is invalid.');
  expect(() =>
    validateManagerOptions({ ...options, limits: { activeStateOperationTimeoutMs: 30_001 } }),
  ).toThrow('Agent manager limit is invalid.');
  expect(() =>
    validateManagerOptions({ ...options, limits: { initializationTimeoutMs: 999 } }),
  ).toThrow('Agent manager limit is invalid.');
  expect(() =>
    validateManagerOptions({ ...options, limits: { initializationTimeoutMs: 1_800_001 } }),
  ).toThrow('Agent manager limit is invalid.');
  expect(() =>
    validateManagerOptions({
      ...options,
      limits: { activeStateOperationTimeoutMs: 2_000, initializationTimeoutMs: 1_000 },
    }),
  ).toThrow('Agent manager limit is invalid.');
});
