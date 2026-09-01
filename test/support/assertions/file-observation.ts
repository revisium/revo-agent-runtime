import { access } from 'node:fs/promises';

export const waitForFile = async (path: string, timeoutMs: number = 2_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  const poll = async (): Promise<void> => {
    try {
      await access(path);
    } catch (error) {
      if (Date.now() >= deadline)
        throw new Error('Expected fixture file was not created.', { cause: error });
      await new Promise((resolve) => setTimeout(resolve, 10));
      await poll();
    }
  };
  await poll();
};
