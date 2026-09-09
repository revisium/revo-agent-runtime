import * as filesystem from 'node:fs/promises';

import { afterEach, expect, test, vi } from 'vitest';

import { inspectLinuxProcessIdentity } from '../../../../src/platform/node/process/identity.js';

vi.mock('node:fs/promises', { spy: true });
afterEach(() => vi.restoreAllMocks());

test.each(['ENOENT', 'EACCES'])(
  'retains %s as the cause when host identity evidence is unavailable',
  async (code) => {
    const cause = Object.assign(new Error('boot identity unavailable'), { code });
    vi.spyOn(filesystem, 'readFile').mockRejectedValueOnce(cause);

    await expect(inspectLinuxProcessIdentity(42)).rejects.toMatchObject({
      message: 'Linux process identity is unavailable.',
      cause,
    });
  },
);
