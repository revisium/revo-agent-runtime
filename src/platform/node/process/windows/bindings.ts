import koffi from 'koffi';

import type { WindowsProcessNative } from './operations.js';

const kernel = koffi.load('kernel32.dll');
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
const accounting = koffi.struct({
  userTime: 'int64_t',
  kernelTime: 'int64_t',
  periodUserTime: 'int64_t',
  periodKernelTime: 'int64_t',
  pageFaults: 'uint32_t',
  total: 'uint32_t',
  active: 'uint32_t',
  terminated: 'uint32_t',
});

export const windowsProcessNative: WindowsProcessNative = {
  lastError: kernel.func('uint32_t __stdcall GetLastError()') as WindowsProcessNative['lastError'],
  closeHandle: kernel.func(
    'int __stdcall CloseHandle(void *)',
  ) as WindowsProcessNative['closeHandle'],
  openProcess: kernel.func(
    'void * __stdcall OpenProcess(uint32_t, int, uint32_t)',
  ) as WindowsProcessNative['openProcess'],
  getTimes: kernel.func(
    'int __stdcall GetProcessTimes(void *, void *, void *, void *, void *)',
  ) as WindowsProcessNative['getTimes'],
  waitForProcess: kernel.func(
    'uint32_t __stdcall WaitForSingleObject(void *, uint32_t)',
  ) as WindowsProcessNative['waitForProcess'],
  createJob: kernel.func(
    'void * __stdcall CreateJobObjectW(void *, const char16_t *)',
  ) as WindowsProcessNative['createJob'],
  openJob: kernel.func(
    'void * __stdcall OpenJobObjectW(uint32_t, int, const char16_t *)',
  ) as WindowsProcessNative['openJob'],
  setJob: kernel.func(
    'int __stdcall SetInformationJobObject(void *, int, void *, uint32_t)',
  ) as WindowsProcessNative['setJob'],
  queryJob: kernel.func(
    'int __stdcall QueryInformationJobObject(void *, int, void *, uint32_t, void *)',
  ) as WindowsProcessNative['queryJob'],
  assignJob: kernel.func(
    'int __stdcall AssignProcessToJobObject(void *, void *)',
  ) as WindowsProcessNative['assignJob'],
  isInJob: kernel.func(
    'int __stdcall IsProcessInJob(void *, void *, void *)',
  ) as WindowsProcessNative['isInJob'],
  terminateJob: kernel.func(
    'int __stdcall TerminateJobObject(void *, uint32_t)',
  ) as WindowsProcessNative['terminateJob'],
  killOnCloseLimits: () => {
    const limits = Buffer.alloc(koffi.sizeof(extendedLimits));
    koffi.encode(limits, extendedLimits, { basic: { flags: 0x2000 } });
    return limits;
  },
  accountingBuffer: () => Buffer.alloc(koffi.sizeof(accounting)),
  activeProcesses: (data) => data.readUInt32LE(koffi.offsetof(accounting, 'active')),
};
