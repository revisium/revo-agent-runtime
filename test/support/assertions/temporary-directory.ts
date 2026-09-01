import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const withTemporaryDirectory = async <Result>(
  run: (directory: string) => Promise<Result>,
): Promise<Result> => {
  const directory = await mkdtemp(join(tmpdir(), 'revo-agent-runtime-test-'));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
};
