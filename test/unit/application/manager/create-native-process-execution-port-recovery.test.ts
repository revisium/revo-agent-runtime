import { afterEach, expect, test, vi } from 'vitest';

const processMock = vi.hoisted(() => ({
  kill: vi.fn<(pid: number, signal: NodeJS.Signals | 0) => boolean>(() => true),
}));

vi.mock('node:process', () => processMock);

import { createNativeProcessExecutionPort } from '../../../../src/application/manager/index.js';
import type {
  ProcessIdentity,
  ProcessCleanupAttemptOutcome,
} from '../../../../src/runtime/execution/index.js';

afterEach(() => {
  vi.restoreAllMocks();
  processMock.kill.mockClear();
});

test('does not signal a recovered process when its fingerprint mismatches', async () => {
  const identity: ProcessIdentity = Object.freeze({
    pid: 123,
    processGroupId: 123,
    fingerprint: 'sha256:actual',
  });
  const dispatch: NonNullable<Parameters<typeof createNativeProcessExecutionPort>[0]> = {
    beginStart: vi.fn(),
    inspectIdentity: vi.fn(),
    killUnactivated: vi.fn(
      async (): Promise<ProcessCleanupAttemptOutcome | undefined> => undefined,
    ),
    activateIo: vi.fn(),
    inspectRecoveredProcessIdentity: vi.fn(async () => ({
      status: 'identified' as const,
      identity,
    })),
  };
  const execution = createNativeProcessExecutionPort(dispatch);

  await expect(
    execution.inspectAndReconcileRecoveredProcess(123, 'sha256:stale', Date.now() + 1_000),
  ).resolves.toEqual({ status: 'identity_mismatch' });
  expect(processMock.kill).toHaveBeenCalledWith(123, 0);
  expect(
    processMock.kill.mock.calls.filter(
      ([, signal]) => signal === 'SIGTERM' || signal === 'SIGKILL',
    ),
  ).toEqual([]);
});
