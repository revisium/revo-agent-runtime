import koffi from 'koffi';

import type { Ownership, Platform } from './platform.js';

const kernel = koffi.load('kernel32.dll');
type Handle = bigint;
const openProcess = kernel.func('void * __stdcall OpenProcess(uint32_t, int, uint32_t)') as (
  access: number,
  inherit: number,
  pid: number,
) => Handle | null;
const closeHandle = kernel.func('int __stdcall CloseHandle(void *)') as (handle: Handle) => number;
const getLastError = kernel.func('uint32_t __stdcall GetLastError()') as () => number;
const getTimes = kernel.func(
  'int __stdcall GetProcessTimes(void *, void *, void *, void *, void *)',
) as (handle: Handle, creation: Buffer, exit: Buffer, kernel: Buffer, user: Buffer) => number;
const waitForProcess = kernel.func('uint32_t __stdcall WaitForSingleObject(void *, uint32_t)') as (
  handle: Handle,
  timeout: number,
) => number;
const createJob = kernel.func('void * __stdcall CreateJobObjectW(void *, const char16_t *)') as (
  attributes: null,
  name: null,
) => Handle | null;
const setJob = kernel.func(
  'int __stdcall SetInformationJobObject(void *, int, void *, uint32_t)',
) as (job: Handle, informationClass: number, data: Buffer, size: number) => number;
const assignJob = kernel.func('int __stdcall AssignProcessToJobObject(void *, void *)') as (
  job: Handle,
  process: Handle,
) => number;
const terminateJob = kernel.func('int __stdcall TerminateJobObject(void *, uint32_t)') as (
  job: Handle,
  exitCode: number,
) => number;

const basicLimits = koffi.struct({
  processTime: 'int64_t',
  jobTime: 'int64_t',
  flags: 'uint32_t',
  minimumWorkingSet: 'size_t',
  maximumWorkingSet: 'size_t',
  activeProcesses: 'uint32_t',
  affinity: 'uintptr_t',
  priority: 'uint32_t',
  scheduling: 'uint32_t',
});
const extendedLimits = koffi.struct({
  basic: basicLimits,
  io: 'uint64_t[6]',
  processMemory: 'size_t',
  jobMemory: 'size_t',
  peakProcessMemory: 'size_t',
  peakJobMemory: 'size_t',
});

const requireSuccess = (success: number, operation: string): void => {
  if (!success) throw new Error(`${operation} failed: win32=${getLastError()}`);
};

const own = (pid: number): Ownership => {
  const job = createJob(null, null);
  if (job === null) throw new Error(`CreateJobObjectW failed: win32=${getLastError()}`);
  try {
    const limits = Buffer.alloc(koffi.sizeof(extendedLimits));
    koffi.encode(limits, extendedLimits, { basic: { flags: 0x2000 } }); // KILL_ON_JOB_CLOSE
    requireSuccess(setJob(job, 9, limits, limits.length), 'SetInformationJobObject');
    const processHandle = openProcess(0x0101, 0, pid); // SET_QUOTA | TERMINATE
    if (processHandle === null) throw new Error(`OpenProcess failed: win32=${getLastError()}`);
    try {
      requireSuccess(assignJob(job, processHandle), 'AssignProcessToJobObject');
    } finally {
      requireSuccess(closeHandle(processHandle), 'CloseHandle(process)');
    }
    let disposed = false;
    return {
      dispose() {
        if (!disposed) {
          disposed = true;
          requireSuccess(closeHandle(job), 'CloseHandle(job)');
        }
      },
      terminate() {
        requireSuccess(terminateJob(job, 1), 'TerminateJobObject');
      },
    };
  } catch (error) {
    closeHandle(job);
    throw error;
  }
};

export const windowsPlatform: Platform = {
  async inspect(pid) {
    const handle = openProcess(0x101000, 0, pid); // QUERY_LIMITED_INFORMATION | SYNCHRONIZE
    if (handle === null) {
      const error = getLastError();
      if (error === 87) return undefined; // Invalid PID; access denied remains an error.
      throw new Error(`OpenProcess failed: win32=${error}, pid=${pid}`);
    }
    try {
      const wait = waitForProcess(handle, 0);
      if (wait === 0) return undefined; // A signaled process handle proves exit.
      if (wait !== 258) throw new Error(`WaitForSingleObject failed: win32=${getLastError()}`);
      const creation = Buffer.alloc(8);
      requireSuccess(
        getTimes(handle, creation, Buffer.alloc(8), Buffer.alloc(8), Buffer.alloc(8)),
        'GetProcessTimes',
      );
      return { pid, token: creation.readBigUInt64LE().toString() };
    } finally {
      requireSuccess(closeHandle(handle), 'CloseHandle(process)');
    }
  },
  own,
};
