import { createHash } from 'node:crypto';

import type { ProcessIdentity } from '../../contracts.js';
import { withNativeResource } from '../../resources.js';

export interface WindowsProcessNative {
  lastError(): number;
  closeHandle(handle: bigint): number;
  openProcess(access: number, inherit: number, pid: number): bigint | null;
  getTimes(handle: bigint, created: Buffer, exited: Buffer, kernel: Buffer, user: Buffer): number;
  waitForProcess(handle: bigint, timeout: number): number;
  createJob(attributes: null, name: string): bigint | null;
  openJob(access: number, inherit: number, name: string): bigint | null;
  setJob(job: bigint, kind: number, data: Buffer, size: number): number;
  queryJob(job: bigint, kind: number, data: Buffer, size: number, returned: null): number;
  assignJob(job: bigint, process: bigint): number;
  isInJob(process: bigint, job: bigint, result: Buffer): number;
  terminateJob(job: bigint, code: number): number;
  killOnCloseLimits(): Buffer;
  accountingBuffer(): Buffer;
  activeProcesses(data: Buffer): number;
}

const requireSuccess = (native: WindowsProcessNative, success: number, operation: string): void => {
  if (!success) throw new Error(`${operation} failed: win32=${native.lastError()}`);
};
const withProcess = <T>(
  native: WindowsProcessNative,
  pid: number,
  access: number,
  use: (handle: bigint) => T,
): T => {
  const handle = native.openProcess(access, 0, pid);
  if (handle === null) {
    const error = native.lastError();
    throw Object.assign(new Error(`OpenProcess failed: win32=${error}`), {
      code: error === 87 ? 'ESRCH' : 'EIO',
    });
  }
  return withNativeResource(
    () => use(handle),
    () => requireSuccess(native, native.closeHandle(handle), 'CloseHandle(process)'),
  );
};

const inspectWindowsIdentity = (
  native: WindowsProcessNative,
  pid: number,
  jobName: string,
): ProcessIdentity =>
  withProcess(native, pid, 0x101000, (handle) => {
    const wait = native.waitForProcess(handle, 0);
    if (wait === 0) throw Object.assign(new Error('Process exited.'), { code: 'ESRCH' });
    if (wait !== 258) throw new Error(`WaitForSingleObject failed: win32=${native.lastError()}`);
    const created = Buffer.alloc(8);
    requireSuccess(
      native,
      native.getTimes(handle, created, Buffer.alloc(8), Buffer.alloc(8), Buffer.alloc(8)),
      'GetProcessTimes',
    );
    const creation = created.readBigUInt64LE();
    const identity = ['win32:v2', jobName, pid, creation].join(':');
    const fingerprint = `sha256:${createHash('sha256').update(identity).digest('hex')}`;
    return Object.freeze({
      version: 2,
      platform: 'win32',
      pid,
      jobName,
      fingerprint,
      startedAt: new Date(Number(creation / 10_000n - 11_644_473_600_000n)).toISOString(),
    });
  });

export interface WindowsJob {
  assign(pid: number): void;
  contains(pid: number): boolean;
  activeProcesses(): number;
  terminate(): void;
  close(): void;
}

const ownedJob = (native: WindowsProcessNative, handle: bigint): WindowsJob => {
  let closed = false;
  let closeFailure: Error | undefined;
  const requireOpen = (): void => {
    if (closed) throw new Error('Job handle is closed.');
  };
  return {
    assign(pid) {
      requireOpen();
      withProcess(native, pid, 0x0101, (process) =>
        requireSuccess(native, native.assignJob(handle, process), 'AssignProcessToJobObject'),
      );
    },
    contains(pid) {
      requireOpen();
      return withProcess(native, pid, 0x1000, (process) => {
        const result = Buffer.alloc(4);
        requireSuccess(native, native.isInJob(process, handle, result), 'IsProcessInJob');
        return result.readInt32LE() !== 0;
      });
    },
    activeProcesses() {
      requireOpen();
      const result = native.accountingBuffer();
      requireSuccess(
        native,
        native.queryJob(handle, 1, result, result.length, null),
        'QueryInformationJobObject',
      );
      return native.activeProcesses(result);
    },
    terminate() {
      requireOpen();
      requireSuccess(native, native.terminateJob(handle, 1), 'TerminateJobObject');
    },
    close() {
      if (closeFailure !== undefined) throw closeFailure;
      if (closed) return;
      closed = true;
      if (native.closeHandle(handle) === 0) {
        closeFailure = new Error(`CloseHandle(job) failed: win32=${native.lastError()}`);
        throw closeFailure;
      }
    },
  };
};

const createWindowsJob = (native: WindowsProcessNative, name: string): WindowsJob => {
  const handle = native.createJob(null, name);
  if (handle === null) throw new Error(`CreateJobObjectW failed: win32=${native.lastError()}`);
  const exists = native.lastError() === 183;
  try {
    if (exists) throw new Error('Process Job name is already owned.');
    const limits = native.killOnCloseLimits();
    requireSuccess(
      native,
      native.setJob(handle, 9, limits, limits.length),
      'SetInformationJobObject',
    );
    return ownedJob(native, handle);
  } catch (error) {
    return withNativeResource(
      () => {
        throw error;
      },
      () => requireSuccess(native, native.closeHandle(handle), 'CloseHandle(job)'),
    );
  }
};

const openWindowsJob = (native: WindowsProcessNative, name: string): WindowsJob | undefined => {
  const handle = native.openJob(0x000c, 0, name); // QUERY | TERMINATE; handles never inherited.
  if (handle !== null) return ownedJob(native, handle);
  const error = native.lastError();
  if (error === 2) return undefined;
  throw new Error(`OpenJobObjectW failed: win32=${error}`);
};

export const createWindowsProcessOperations = (native: WindowsProcessNative) => ({
  createWindowsJob: (name: string) => createWindowsJob(native, name),
  openWindowsJob: (name: string) => openWindowsJob(native, name),
  inspectWindowsIdentity: (pid: number, jobName: string) =>
    inspectWindowsIdentity(native, pid, jobName),
});
