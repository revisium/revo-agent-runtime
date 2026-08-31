import { createHash } from 'node:crypto';
import { readFile, readlink } from 'node:fs/promises';

import type { ProcessIdentity } from '../../../execution/process/port.js';

export type ProcessIdentityInspector = (pid: number) => Promise<ProcessIdentity>;

export const parseLinuxProcessIdentity = (
  pid: number,
  stat: string,
  executable: string,
  bootSessionIdentity: string,
  startedAt: string,
): ProcessIdentity => {
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
  const [stat, executable, bootSessionIdentity] = await Promise.all([
    readFile(`/proc/${pid}/stat`, 'utf8'),
    readlink(`/proc/${pid}/exe`),
    readFile('/proc/sys/kernel/random/boot_id', 'utf8'),
  ]);
  return parseLinuxProcessIdentity(
    pid,
    stat,
    executable,
    bootSessionIdentity,
    new Date().toISOString(),
  );
};
