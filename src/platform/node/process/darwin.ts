import { createHash } from 'node:crypto';

import koffi from 'koffi';

import type { ProcessGroupIdentity } from '../../../execution/process/port.js';

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

export const inspectDarwinProcessIdentity = async (pid: number): Promise<ProcessGroupIdentity> => {
  const buffer = Buffer.alloc(koffi.sizeof(bsdInfo));
  const size = pidInfo(pid, 3, 0, buffer, buffer.length);
  if (size === 0) {
    const errno = koffi.errno();
    throw Object.assign(new Error(`proc_pidinfo failed: errno=${errno}, pid=${pid}`), {
      code: errno === 3 ? 'ESRCH' : 'EIO',
    });
  }
  if (size !== buffer.length) throw new Error(`Unexpected proc_bsdinfo size: ${size}`);
  const seconds = buffer.readBigUInt64LE(koffi.offsetof(bsdInfo, 'startSeconds'));
  const microseconds = buffer.readBigUInt64LE(koffi.offsetof(bsdInfo, 'startMicroseconds'));
  const processGroupId = buffer.readUInt32LE(koffi.offsetof(bsdInfo, 'group'));
  const fingerprint = `sha256:${createHash('sha256').update(`darwin:v2:${bootIdentity()}:${pid}:${processGroupId}:${seconds}:${microseconds}`).digest('hex')}`;
  return Object.freeze({
    version: 2,
    platform: 'darwin',
    pid,
    processGroupId,
    fingerprint,
    startedAt: new Date(Number(seconds) * 1_000 + Number(microseconds) / 1_000).toISOString(),
  });
};

const sysctl = koffi
  .load('/usr/lib/libSystem.B.dylib')
  .func('int sysctlbyname(const char *, void *, void *, void *, size_t)') as (
  name: string,
  output: Buffer,
  size: Buffer,
  input: null,
  length: number,
) => number;
const bootIdentity = (): string => {
  const output = Buffer.alloc(64);
  const size = Buffer.alloc(8);
  size.writeBigUInt64LE(BigInt(output.length));
  if (sysctl('kern.bootsessionuuid', output, size, null, 0) !== 0)
    throw new Error(`Cannot read boot identity: errno=${koffi.errno()}`);
  const value = output
    .subarray(0, Number(size.readBigUInt64LE()))
    .toString('utf8')
    .replace(/\0+$/u, '');
  if (!value) throw new Error('Empty boot identity');
  return value;
};
