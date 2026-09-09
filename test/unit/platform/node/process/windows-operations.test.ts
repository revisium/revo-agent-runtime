import { expect, test } from 'vitest';

import { createWindowsProcessOperations } from '../../../../../src/process/node/windows/operations.js';
import { windowsProcessFixture } from '../../../../support/fixtures/windows-process-native.js';

const jobName = 'revo-12345678-1234-1234-1234-123456789abc';

const scenario = () => {
  const fixture = windowsProcessFixture();
  return { ...fixture, operations: createWindowsProcessOperations(fixture.native) };
};

test('identifies a live process consistently and records its native creation time', () => {
  const fixture = scenario();

  const identity = fixture.operations.inspectWindowsIdentity(42, jobName);

  expect(identity).toMatchObject({
    pid: 42,
    jobName,
    platform: 'win32',
    version: 2,
    startedAt: '1970-01-01T00:00:00.000Z',
  });
  expect(fixture.operations.inspectWindowsIdentity(42, jobName)).toEqual(identity);
  expect(fixture.owned).toEqual(new Set());
});

test('binds a process fingerprint to its Job, PID and creation time', () => {
  const fixture = scenario();
  const first = fixture.operations.inspectWindowsIdentity(42, jobName);

  expect(fixture.operations.inspectWindowsIdentity(43, jobName).fingerprint).not.toBe(
    first.fingerprint,
  );
  expect(fixture.operations.inspectWindowsIdentity(42, `${jobName}-other`).fingerprint).not.toBe(
    first.fingerprint,
  );
  fixture.native.getTimes = (_handle, created) => {
    created.writeBigUInt64LE(116444736000010000n);
    return 1;
  };
  expect(fixture.operations.inspectWindowsIdentity(42, jobName).fingerprint).not.toBe(
    first.fingerprint,
  );
});

test.each([
  [87, 'ESRCH'],
  [5, 'EIO'],
])('classifies OpenProcess error %i as %s without closing a nonexistent handle', (error, code) => {
  const fixture = scenario();
  fixture.native.openProcess = () => null;
  fixture.setError(error);

  expect(() => fixture.operations.inspectWindowsIdentity(42, jobName)).toThrow(
    expect.objectContaining({ code }),
  );
  expect(fixture.closed).toEqual([]);
});

test('reports an exited process as absent and releases its handle', () => {
  const fixture = scenario();
  fixture.native.waitForProcess = () => 0;

  expect(() => fixture.operations.inspectWindowsIdentity(42, jobName)).toThrow(
    expect.objectContaining({ code: 'ESRCH' }),
  );
  expect(fixture.owned).toEqual(new Set());
});

test('retains native wait uncertainty instead of reporting the process absent', () => {
  const fixture = scenario();
  fixture.native.waitForProcess = () => 0xffffffff;
  fixture.setError(6);

  expect(() => fixture.operations.inspectWindowsIdentity(42, jobName)).toThrow(
    'WaitForSingleObject failed: win32=6',
  );
  expect(fixture.owned).toEqual(new Set());
});

test('releases the process handle when reading creation time fails', () => {
  const fixture = scenario();
  fixture.fail('getTimes');

  expect(() => fixture.operations.inspectWindowsIdentity(42, jobName)).toThrow(
    'GetProcessTimes failed',
  );
  expect(fixture.owned).toEqual(new Set());
});

test('preserves identity failure together with a failed handle release', () => {
  const fixture = scenario();
  fixture.fail('getTimes', 87);
  fixture.fail('closeHandle', 6);

  expect(() => fixture.operations.inspectWindowsIdentity(42, jobName)).toThrow(
    expect.objectContaining({
      errors: [
        expect.objectContaining({ message: 'GetProcessTimes failed: win32=87' }),
        expect.objectContaining({ message: 'CloseHandle(process) failed: win32=6' }),
      ],
    }),
  );
});

test('does not confirm an identity if releasing its temporary handle fails', () => {
  const fixture = scenario();
  fixture.fail('closeHandle');

  expect(() => fixture.operations.inspectWindowsIdentity(42, jobName)).toThrow(
    'CloseHandle(process) failed',
  );
});

test('configures a new Job before admitting a process and closes its handle once', () => {
  const fixture = scenario();
  const job = fixture.operations.createWindowsJob(jobName);

  expect(fixture.configured).toEqual([2n]);
  job.assign(42);
  expect(fixture.assigned).toEqual([3n]);
  expect(fixture.owned).toEqual(new Set([2n]));
  job.close();
  job.close();
  expect(fixture.closed).toEqual([3n, 2n]);
});

test('refuses a Job name collision without changing or terminating the existing Job', () => {
  const fixture = scenario();
  fixture.setError(183);

  expect(() => fixture.operations.createWindowsJob(jobName)).toThrow('already owned');
  expect(fixture.closed).toEqual([2n]);
  expect(fixture.configured).toEqual([]);
  expect(fixture.terminated).toEqual([]);
});

test('does not close an unacquired Job when creation fails', () => {
  const fixture = scenario();
  fixture.native.createJob = () => null;
  fixture.setError(5);

  expect(() => fixture.operations.createWindowsJob(jobName)).toThrow(
    'CreateJobObjectW failed: win32=5',
  );
  expect(fixture.closed).toEqual([]);
});

test('releases a new Job whose cleanup limits could not be configured', () => {
  const fixture = scenario();
  fixture.fail('setJob');

  expect(() => fixture.operations.createWindowsJob(jobName)).toThrow(
    'SetInformationJobObject failed',
  );
  expect(fixture.owned).toEqual(new Set());
});

test('preserves a Job admission error when closing the acquired Job also fails', () => {
  const fixture = scenario();
  fixture.fail('setJob', 87);
  fixture.fail('closeHandle', 6);

  expect(() => fixture.operations.createWindowsJob(jobName)).toThrow(
    expect.objectContaining({
      errors: [
        expect.objectContaining({ message: 'SetInformationJobObject failed: win32=87' }),
        expect.objectContaining({ message: 'CloseHandle(job) failed: win32=6' }),
      ],
    }),
  );
});

test('reopens an existing Job without changing its limits', () => {
  const fixture = scenario();
  const job = fixture.operations.openWindowsJob(jobName);

  expect(job).toBeDefined();
  expect(fixture.configured).toEqual([]);
  job!.close();
  expect(fixture.owned).toEqual(new Set());
});

test('returns absence only when Windows confirms that the named Job does not exist', () => {
  const fixture = scenario();
  fixture.native.openJob = () => null;
  fixture.setError(2);

  expect(fixture.operations.openWindowsJob(jobName)).toBeUndefined();
  expect(fixture.closed).toEqual([]);
});

test('retains Job access denial instead of reporting it absent', () => {
  const fixture = scenario();
  fixture.native.openJob = () => null;
  fixture.setError(5);

  expect(() => fixture.operations.openWindowsJob(jobName)).toThrow(
    'OpenJobObjectW failed: win32=5',
  );
  expect(fixture.closed).toEqual([]);
});

test('checks membership and live descendant count before terminating an owned Job', () => {
  const fixture = scenario();
  const job = fixture.operations.createWindowsJob(jobName);

  expect(job.contains(42)).toBe(true);
  expect(job.activeProcesses()).toBe(2);
  job.terminate();
  expect(fixture.terminated).toEqual([2n]);
  job.close();
});

test('reports a process outside the Job without retaining its inspection handle', () => {
  const fixture = scenario();
  fixture.native.isInJob = () => 1;
  const job = fixture.operations.createWindowsJob(jobName);

  expect(job.contains(42)).toBe(false);
  expect(fixture.owned).toEqual(new Set([2n]));
  job.close();
});

test.each(['assignJob', 'isInJob', 'queryJob', 'terminateJob'] as const)(
  'retains ownership and reports a failed %s operation',
  (operation) => {
    const fixture = scenario();
    const job = fixture.operations.createWindowsJob(jobName);
    fixture.fail(operation);
    const action = {
      assignJob: () => job.assign(42),
      isInJob: () => job.contains(42),
      queryJob: () => job.activeProcesses(),
      terminateJob: () => job.terminate(),
    }[operation];

    expect(action).toThrow('win32=5');
    expect(fixture.owned).toEqual(new Set([2n]));
    job.close();
  },
);

test.each(['assign', 'contains', 'activeProcesses', 'terminate'] as const)(
  'rejects %s after closing the Job so a recycled handle cannot be used',
  (operation) => {
    const fixture = scenario();
    const job = fixture.operations.createWindowsJob(jobName);
    job.close();

    expect(() => job[operation](42)).toThrow('Job handle is closed');
    expect(fixture.assigned).toEqual([]);
    expect(fixture.terminated).toEqual([]);
  },
);

test('retains a failed close outcome without closing a potentially recycled handle again', () => {
  const fixture = scenario();
  const job = fixture.operations.createWindowsJob(jobName);
  fixture.fail('closeHandle');

  expect(() => job.close()).toThrow('CloseHandle(job) failed');
  expect(() => job.close()).toThrow('CloseHandle(job) failed');
  expect(() => job.terminate()).toThrow('Job handle is closed');
});
