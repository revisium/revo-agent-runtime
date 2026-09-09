import koffi from 'koffi';

import type { Identity } from './platform.js';

// Apple xnu/bsd/sys/proc_info.h: PROC_PIDTBSDINFO and struct proc_bsdinfo.
const bsdInfo = koffi.struct({
  flags: 'uint32_t',
  status: 'uint32_t',
  exitStatus: 'uint32_t',
  pid: 'uint32_t',
  parentPid: 'uint32_t',
  uid: 'uint32_t',
  gid: 'uint32_t',
  realUid: 'uint32_t',
  realGid: 'uint32_t',
  savedUid: 'uint32_t',
  savedGid: 'uint32_t',
  reserved: 'uint32_t',
  command: 'char[16]',
  name: 'char[32]',
  files: 'uint32_t',
  group: 'uint32_t',
  jobCount: 'uint32_t',
  terminal: 'uint32_t',
  terminalGroup: 'uint32_t',
  nice: 'int32_t',
  startSeconds: 'uint64_t',
  startMicroseconds: 'uint64_t',
});
const lib = koffi.load('/usr/lib/libproc.dylib');
const pidInfo = lib.func('int proc_pidinfo(int, int, uint64_t, void *, int)') as (
  pid: number,
  flavor: number,
  arg: number,
  output: Buffer,
  size: number,
) => number;

export const inspectDarwin = async (pid: number): Promise<Identity | undefined> => {
  const buffer = Buffer.alloc(koffi.sizeof(bsdInfo));
  const size = pidInfo(pid, 3, 0, buffer, buffer.length);
  if (size === 0) {
    const errno = koffi.errno();
    if (errno === 3) return undefined; // ESRCH only; permissions are not absence.
    throw new Error(`proc_pidinfo failed: errno=${errno}, pid=${pid}`);
  }
  if (size !== buffer.length) throw new Error(`Unexpected proc_bsdinfo size: ${size}`);
  const seconds = buffer.readBigUInt64LE(koffi.offsetof(bsdInfo, 'startSeconds'));
  const microseconds = buffer.readBigUInt64LE(koffi.offsetof(bsdInfo, 'startMicroseconds'));
  return { pid, token: `${seconds}:${microseconds}` };
};
