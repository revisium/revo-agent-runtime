import { expect, test } from 'vitest';

import { rejectProcessStart } from '../../../../src/process/node/start-error.js';

test.each(['confirmed', 'uncertain'] as const)(
  'retains the launch cause after %s cleanup',
  async (status) => {
    const cause = new Error('identity unavailable');
    const cleanup = async () => ({ status, exit: { exitCode: 1, signal: null } });

    await expect(rejectProcessStart(cause, cleanup)).rejects.toMatchObject({
      name: 'ProcessStartError',
      cleanup: status,
      cause,
    });
  },
);

test('a cleanup exception preserves both failures and cannot imply a confirmed reap', async () => {
  const launchFailure = new Error('identity unavailable');
  const cleanupFailure = new Error('Job cleanup unavailable');
  const cleanup = async () => {
    throw cleanupFailure;
  };

  await expect(rejectProcessStart(launchFailure, cleanup)).rejects.toMatchObject({
    name: 'ProcessStartError',
    cleanup: 'uncertain',
    cause: expect.objectContaining({ errors: [launchFailure, cleanupFailure] }),
  });
});
