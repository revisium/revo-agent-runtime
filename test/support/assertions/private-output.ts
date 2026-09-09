import { stat } from 'node:fs/promises';

import { expect } from 'vitest';

export const expectPrivateOutput = async (
  paths: readonly string[],
  mode: number,
): Promise<void> => {
  if (process.platform === 'win32') return;
  const modes = await Promise.all(paths.map(async (path) => (await stat(path)).mode & 0o777));
  expect(modes).toEqual(paths.map(() => mode));
};
