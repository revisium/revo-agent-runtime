import { expect, test } from 'vitest';

import { settleOperation } from '../../../../../src/execution/session/interpreter/shared/operation/settlement.js';

test('ignores stale timer callbacks after an operation wins its observation window', async () => {
  let callback: (() => void) | undefined;
  const settlement = await settleOperation({
    onTimeout: () => undefined,
    operation: Promise.resolve('done'),
    timeoutMs: 10,
    timer: {
      schedule: (_milliseconds, scheduled) => {
        callback = scheduled;
        return { cancel: () => undefined };
      },
    },
  });
  callback?.();
  expect(settlement).toEqual({ phase: 'initial', state: 'fulfilled', value: 'done' });
});
