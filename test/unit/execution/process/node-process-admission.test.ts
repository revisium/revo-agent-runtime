import { join } from 'node:path';

import { expect, test } from 'vitest';

import { ProcessStartError, type ProcessExit } from '../../../../src/execution/process/port.js';
import {
  createProcessCleanup,
  nodeProcessGroupSystem,
  type ProcessGroupSystem,
} from '../../../../src/platform/node/process/cleanup.js';
import { nodeErrorCode } from '../../../../src/platform/node/process/errors.js';
import { parseLinuxProcessIdentity } from '../../../../src/platform/node/process/identity.js';
import { createNodeRecoveredProcessInspector } from '../../../../src/platform/node/process/recovered-process.js';
import { createNodeProcessSpawner } from '../../../../src/platform/node/process/spawner.js';

const longRunningNode = {
  args: ['-e', 'setInterval(() => undefined, 1_000)'],
  command: process.execPath,
  cwd: process.cwd(),
};

const confirmedIdentity = (pid: number) => ({
  fingerprint: 'sha256:fixture',
  pid,
  processGroupId: pid,
  startedAt: '2026-01-01T00:00:00.000Z',
});

const processGroupScenario = (options: {
  readonly killAccepted?: boolean;
  readonly goneAfterKill?: boolean;
  readonly goneAfterTerm?: boolean;
  readonly termAccepted?: boolean;
}): ProcessGroupSystem => {
  let now = 0;
  let lastSignal: NodeJS.Signals | undefined;
  return {
    groupIsGone: () =>
      lastSignal === 'SIGKILL' ? (options.goneAfterKill ?? true) : (options.goneAfterTerm ?? true),
    now: () => now,
    signal: (_processGroupId, signal) => {
      lastSignal = signal;
      return signal === 'SIGTERM' ? (options.termAccepted ?? true) : (options.killAccepted ?? true);
    },
    wait: async (milliseconds) => {
      now += milliseconds;
    },
  };
};
test('constructs stable public identity fields from Linux process evidence', () => {
  const fields = ['S', '1', '42', ...Array.from({ length: 16 }, () => '0'), '9001'];

  const identity = parseLinuxProcessIdentity(
    42,
    `42 (fixture process) ${fields.join(' ')}`,
    '/fixture/agent',
    'fixture-boot-id\n',
    '2026-01-01T00:00:00.000Z',
  );

  expect(identity.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
  expect(identity).toMatchObject({
    pid: 42,
    processGroupId: 42,
    startedAt: '2026-01-01T00:00:00.000Z',
  });
});

test('rejects malformed Linux identity evidence', () => {
  expect(() =>
    parseLinuxProcessIdentity(
      42,
      '42 (fixture) malformed',
      '/fixture/agent',
      'fixture-boot-id',
      '2026-01-01T00:00:00.000Z',
    ),
  ).toThrow('Owned process identity is invalid.');
});

test('identity inspection failure terminates and reaps the detached process group', async () => {
  const spawner = createNodeProcessSpawner(async () => {
    throw new Error('identity unavailable');
  });

  await expect(spawner.start(longRunningNode, new AbortController().signal)).rejects.toEqual(
    new ProcessStartError('confirmed'),
  );
});

test('abort during identity inspection cleans up before process admission', async () => {
  let inspectedPid = 0;
  let releaseIdentity!: () => void;
  const identityReady = new Promise<void>((resolve) => {
    releaseIdentity = resolve;
  });
  const spawner = createNodeProcessSpawner(async (pid) => {
    inspectedPid = pid;
    await identityReady;
    return confirmedIdentity(pid);
  });
  const controller = new AbortController();

  const starting = spawner.start(longRunningNode, controller.signal);
  await expect.poll(() => inspectedPid).not.toBe(0);
  controller.abort();
  releaseIdentity();

  await expect(starting).rejects.toEqual(new ProcessStartError('confirmed'));
});

test('an already-aborted process start never spawns a child', async () => {
  const controller = new AbortController();
  controller.abort();

  await expect(
    createNodeProcessSpawner().start(longRunningNode, controller.signal),
  ).rejects.toThrow('Owned process start was cancelled.');
});

test('a failed OS spawn never reaches identity inspection or exposes a partial owned process', async () => {
  let identityInspections = 0;
  const spawner = createNodeProcessSpawner(async (pid) => {
    identityInspections += 1;
    return confirmedIdentity(pid);
  });

  await expect(
    spawner.start(
      { ...longRunningNode, command: join(process.cwd(), '.missing-agent-executable') },
      new AbortController().signal,
    ),
  ).rejects.toThrow();
  expect(identityInspections).toBe(0);
});

test('cleanup is uncertain when TERM or KILL cannot be delivered', async () => {
  const leaderExit = Promise.resolve<ProcessExit>({ exitCode: null, signal: 'SIGTERM' });
  const termDenied = createProcessCleanup(
    42,
    leaderExit,
    processGroupScenario({ termAccepted: false }),
  );
  const killDenied = createProcessCleanup(
    42,
    leaderExit,
    processGroupScenario({ goneAfterTerm: false, killAccepted: false }),
  );

  await expect(termDenied()).resolves.toEqual({ status: 'uncertain' });
  await expect(killDenied()).resolves.toEqual({ status: 'uncertain' });
});

test('cleanup requires both descendant exit and leader reap confirmation', async () => {
  const groupSurvives = createProcessCleanup(
    42,
    Promise.resolve({ exitCode: null, signal: 'SIGKILL' }),
    processGroupScenario({ goneAfterKill: false, goneAfterTerm: false }),
  );
  const leaderNotReaped = createProcessCleanup(
    42,
    new Promise(() => undefined),
    processGroupScenario({ goneAfterTerm: true }),
  );

  await expect(groupSurvives()).resolves.toEqual({ status: 'uncertain' });
  await expect(leaderNotReaped()).resolves.toEqual({ status: 'uncertain' });
});

test('system process-group signals distinguish gone and invalid targets', () => {
  expect(nodeProcessGroupSystem.signal(2_000_000_000, 'SIGTERM')).toBe(true);
  expect(nodeProcessGroupSystem.signal(Number.MAX_SAFE_INTEGER, 'SIGTERM')).toBe(false);
  expect(nodeErrorCode({ code: 'ESRCH' })).toBe('ESRCH');
  expect(nodeErrorCode({ code: 3 })).toBeUndefined();
  expect(nodeErrorCode(null)).toBeUndefined();
});

test('recovery never signals a persisted process identity after fingerprint mismatch', async () => {
  const signalled: number[] = [];
  const system: ProcessGroupSystem = {
    groupIsGone: () => false,
    now: () => 0,
    signal: (processGroupId) => {
      signalled.push(processGroupId);
      return true;
    },
    wait: async () => undefined,
  };
  const inspector = createNodeRecoveredProcessInspector(
    async (pid) => confirmedIdentity(pid),
    system,
  );

  await expect(
    inspector.inspectAndReconcileRecoveredProcess(
      { ...confirmedIdentity(42), fingerprint: 'sha256:persisted' },
      new AbortController().signal,
    ),
  ).resolves.toEqual({ status: 'identity_mismatch' });
  expect(signalled).toEqual([]);
});
