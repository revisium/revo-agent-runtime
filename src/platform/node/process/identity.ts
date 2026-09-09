import { createHash } from 'node:crypto';
import { readFile, readlink } from 'node:fs/promises';

import type { ProcessGroupIdentity } from '../../../execution/process/port.js';

export type ProcessIdentityInspector = (pid: number) => Promise<ProcessGroupIdentity>;

export const parseLinuxProcessIdentity = (
  pid: number,
  stat: string,
  executable: string,
  bootSessionIdentity: string,
  startedAt: string,
): ProcessGroupIdentity => {
  const fields = stat
    .slice(stat.lastIndexOf(')') + 2)
    .trim()
    .split(/\s+/);
  const processGroupId = Number(fields[2]);
  const startTicks = fields[19];
  if (!Number.isSafeInteger(processGroupId) || processGroupId < 1 || startTicks === undefined)
    throw new Error('Owned process identity is invalid.');
  const fingerprint = `sha256:${createHash('sha256')
    .update(
      `${bootSessionIdentity.trim()}\n${pid}\n${processGroupId}\n${executable}\n${startTicks}`,
    )
    .digest('hex')}`;
  return Object.freeze({ fingerprint, pid, processGroupId, startedAt });
};

export const inspectLinuxProcessIdentity: ProcessIdentityInspector = async (pid) => {
  // A missing procfs/boot identity is unavailable evidence, never an absent process.
  const bootSessionIdentity = await readFile('/proc/sys/kernel/random/boot_id', 'utf8').catch(
    (cause: unknown) => {
      throw new Error('Linux process identity is unavailable.', { cause });
    },
  );
  const [stat, executable] = await Promise.all([
    readFile(`/proc/${pid}/stat`, 'utf8'),
    readlink(`/proc/${pid}/exe`),
  ]);
  return Object.freeze({
    ...parseLinuxProcessIdentity(
      pid,
      stat,
      executable,
      bootSessionIdentity,
      new Date().toISOString(),
    ),
    version: 2,
    platform: 'linux',
  });
};
