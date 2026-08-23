import { spawn } from 'node:child_process';

import { afterEach, expect, test, vi } from 'vitest';

import { terminateProcessGroupAndReap } from '../../../src/platform/process/posix-process-group-termination.js';
import type { ProcessCleanupOutcome } from '../../../src/platform/process/process-cleanup-outcome.js';

const timeouts = Object.freeze({
  reconcileTimeoutMs: 10,
  terminationGraceMs: 10,
  postKillTimeoutMs: 50,
  postTermReapTimeoutMs: 20,
  terminationPollMs: 1,
});

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
}

const deferred = <Value>(): Deferred<Value> => {
  let resolve: ((value: Value) => void) | undefined;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  if (resolve === undefined) throw new Error('Unable to create deferred helper.');
  return { promise, resolve };
};

const codedError = (code: string): Error => Object.assign(new Error(code), { code });

const closedChild = (child: ReturnType<typeof spawn>): Promise<void> =>
  new Promise((resolve) => {
    child.once('close', () => resolve());
  });

const waitForAbsentGroup = async (processGroupId: number, attempts = 50): Promise<void> => {
  try {
    process.kill(-processGroupId, 0);
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return;
    throw error;
  }
  if (attempts < 1) throw new Error('Timed out waiting for absent process group.');
  await new Promise((resolve) => setTimeout(resolve, 2));
  return waitForAbsentGroup(processGroupId, attempts - 1);
};

afterEach(() => {
  vi.restoreAllMocks();
});

test('fulfills with inspection_rejected when liveness probing throws unexpectedly', async () => {
  await expect(
    terminateProcessGroupAndReap(12_345, Promise.resolve(), timeouts, {
      probe: () => {
        throw codedError('EINVAL');
      },
    }),
  ).resolves.toEqual({
    cause: 'inspection_rejected',
    termSent: false,
    killSent: false,
    lastKnownGroupState: 'unknown',
    leaderReapState: 'unknown',
  } satisfies ProcessCleanupOutcome);
});

test('fulfills with termination_rejected when SIGTERM dispatch is rejected', async () => {
  await expect(
    terminateProcessGroupAndReap(12_345, Promise.resolve(), timeouts, {
      probe: () => 'present',
      signal: (_processGroupId, signal) => {
        if (signal === 'SIGTERM') throw codedError('EINVAL');
      },
    }),
  ).resolves.toEqual({
    cause: 'termination_rejected',
    termSent: false,
    killSent: false,
    lastKnownGroupState: 'present',
    leaderReapState: 'unknown',
  } satisfies ProcessCleanupOutcome);
});

test('fulfills with post_kill_confirmation_rejected when SIGKILL dispatch is rejected', async () => {
  await expect(
    terminateProcessGroupAndReap(12_345, Promise.resolve(), timeouts, {
      probe: () => 'present',
      signal: (_processGroupId, signal) => {
        if (signal === 'SIGKILL') throw codedError('EINVAL');
      },
    }),
  ).resolves.toEqual({
    cause: 'post_kill_confirmation_rejected',
    termSent: true,
    killSent: false,
    lastKnownGroupState: 'present',
    leaderReapState: 'unknown',
  } satisfies ProcessCleanupOutcome);
});

test.runIf(process.platform === 'linux')(
  'confirms an already-exited process without signalling',
  async () => {
    const child = spawn(process.execPath, ['--eval', ''], {
      detached: true,
      stdio: 'ignore',
    });
    if (child.pid === undefined) throw new Error('Expected child pid.');
    const processGroupId = child.pid;
    await closedChild(child);
    await waitForAbsentGroup(processGroupId);
    const signals: Array<readonly [number, NodeJS.Signals]> = [];

    await expect(
      terminateProcessGroupAndReap(processGroupId, Promise.resolve(), timeouts, {
        signal: (groupId, signal) => {
          signals.push([groupId, signal]);
          process.kill(-groupId, signal);
        },
      }),
    ).resolves.toBeUndefined();
    expect(signals).toEqual([]);
  },
);

test.runIf(process.platform === 'linux')(
  'does not signal when group is absent but leader reap misses the reconcile deadline',
  async () => {
    const child = spawn(process.execPath, ['--eval', ''], {
      detached: true,
      stdio: 'ignore',
    });
    if (child.pid === undefined) throw new Error('Expected child pid.');
    const processGroupId = child.pid;
    await closedChild(child);
    await waitForAbsentGroup(processGroupId);
    const completion = deferred<void>();
    const signals: Array<readonly [number, NodeJS.Signals]> = [];

    await expect(
      terminateProcessGroupAndReap(processGroupId, completion.promise, timeouts, {
        signal: (groupId, signal) => {
          signals.push([groupId, signal]);
          process.kill(-groupId, signal);
        },
      }),
    ).resolves.toEqual({
      cause: 'leader_reap_timeout',
      termSent: false,
      killSent: false,
      lastKnownGroupState: 'absent',
      leaderReapState: 'pending',
    } satisfies ProcessCleanupOutcome);
    expect(signals).toEqual([]);
    completion.resolve();
  },
);

test.runIf(process.platform === 'linux')(
  'escalates to SIGKILL when a process ignores SIGTERM',
  async () => {
    const child = spawn(
      process.execPath,
      ['--eval', "process.on('SIGTERM',()=>{}); setInterval(()=>{}, 1000);"],
      { detached: true, stdio: 'ignore' },
    );
    if (child.pid === undefined) throw new Error('Expected child pid.');
    const processGroupId = child.pid;
    const completion = closedChild(child);
    const signals: Array<readonly [number, NodeJS.Signals]> = [];
    await new Promise((resolve) => setTimeout(resolve, 50));

    await terminateProcessGroupAndReap(processGroupId, completion, timeouts, {
      signal: (groupId, signal) => {
        signals.push([groupId, signal]);
        process.kill(-groupId, signal);
      },
    });

    expect(signals).toContainEqual([processGroupId, 'SIGTERM']);
    expect(signals).toContainEqual([processGroupId, 'SIGKILL']);
  },
);
