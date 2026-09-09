import { setTimeout as delay } from 'node:timers/promises';

import type { WindowsJob } from './operations.js';

export const waitForWindowsJob = async (
  job: WindowsJob,
  deadline: number,
  signal?: AbortSignal,
): Promise<boolean> => {
  if (job.activeProcesses() === 0) return true;
  if (Date.now() >= deadline || signal?.aborted) return false;
  await delay(20);
  return waitForWindowsJob(job, deadline, signal);
};
