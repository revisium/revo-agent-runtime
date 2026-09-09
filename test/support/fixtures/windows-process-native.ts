import type { WindowsProcessNative } from '../../../src/platform/node/process/windows/operations.js';

type FailingCall =
  | 'closeHandle'
  | 'getTimes'
  | 'setJob'
  | 'queryJob'
  | 'assignJob'
  | 'isInJob'
  | 'terminateJob';

export const windowsProcessFixture = () => {
  const owned = new Set<bigint>();
  const closed: bigint[] = [];
  const configured: bigint[] = [];
  const terminated: bigint[] = [];
  const assigned: bigint[] = [];
  let error = 0;
  const native: WindowsProcessNative = {
    lastError: () => error,
    closeHandle: (handle) => {
      closed.push(handle);
      owned.delete(handle);
      return 1;
    },
    openProcess: () => {
      owned.add(3n);
      return 3n;
    },
    getTimes: (_handle, created) => {
      created.writeBigUInt64LE(116444736000000000n);
      return 1;
    },
    waitForProcess: () => 258,
    createJob: () => {
      owned.add(2n);
      return 2n;
    },
    openJob: () => {
      owned.add(2n);
      return 2n;
    },
    setJob: (job) => {
      configured.push(job);
      return 1;
    },
    queryJob: (_job, _kind, data) => {
      data.writeUInt32LE(2);
      return 1;
    },
    assignJob: (_job, processHandle) => {
      assigned.push(processHandle);
      return 1;
    },
    isInJob: (_process, _job, data) => {
      data.writeInt32LE(1);
      return 1;
    },
    terminateJob: (job) => {
      terminated.push(job);
      return 1;
    },
    killOnCloseLimits: () => Buffer.alloc(4),
    accountingBuffer: () => Buffer.alloc(4),
    activeProcesses: (data) => data.readUInt32LE(),
  };
  return {
    native,
    owned,
    closed,
    configured,
    terminated,
    assigned,
    setError(code: number) {
      error = code;
    },
    fail(call: FailingCall, code = 5) {
      native[call] = () => {
        error = code;
        return 0;
      };
    },
  };
};
