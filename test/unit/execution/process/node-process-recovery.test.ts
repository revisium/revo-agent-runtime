import { expect, test, vi } from 'vitest';

import { type ProcessGroupSystem } from '../../../../src/process/node/cleanup.js';
import {
  createNodeRecoveredProcessInspector,
  nodeRecoveredProcessInspector,
} from '../../../../src/process/node/recovered-process.js';

const windowsIdentity = {
  version: 2,
  platform: 'win32',
  pid: 2_147_483_647,
  jobName: 'revo-00000000-0000-0000-0000-000000000000',
  fingerprint: `sha256:${'0'.repeat(64)}`,
  startedAt: '2026-01-01T00:00:00.000Z',
} as const;

test('POSIX recovery never inspects a Windows process identity', async () => {
  const inspect = vi.fn(async (pid: number) => confirmedIdentity(pid));
  const recovery = createNodeRecoveredProcessInspector(inspect);

  await expect(
    recovery.inspectAndReconcileRecoveredProcess(windowsIdentity, AbortSignal.timeout(1000)),
  ).resolves.toEqual({ status: 'inconclusive' });
  expect(inspect).not.toHaveBeenCalled();
});

test('platform routing rejects foreign process identities before native inspection', async () => {
  const identity =
    process.platform === 'win32'
      ? { ...confirmedIdentity(2_147_483_647), version: 2 as const, platform: 'darwin' as const }
      : windowsIdentity;

  await expect(
    nodeRecoveredProcessInspector.inspectAndReconcileRecoveredProcess(
      identity,
      AbortSignal.timeout(1000),
    ),
  ).resolves.toEqual({ status: 'inconclusive' });
});

test('legacy process identities are reconciled only on Linux', async () => {
  await expect(
    nodeRecoveredProcessInspector.inspectAndReconcileRecoveredProcess(
      confirmedIdentity(2_147_483_647),
      AbortSignal.timeout(1000),
    ),
  ).resolves.toEqual({ status: process.platform === 'linux' ? 'absent' : 'inconclusive' });
});

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
test('recovery signals only the freshly inspected process group after identity match', async () => {
  const signalled: Array<readonly [number, NodeJS.Signals]> = [];
  let gone = false;
  const system: ProcessGroupSystem = {
    groupIsGone: () => gone,
    now: () => 0,
    signal: (processGroupId, signal) => {
      signalled.push([processGroupId, signal]);
      gone = true;
      return true;
    },
    wait: async () => undefined,
  };
  const authentic = { ...confirmedIdentity(42), processGroupId: 84 };
  const inspector = createNodeRecoveredProcessInspector(async () => authentic, system);

  await expect(
    inspector.inspectAndReconcileRecoveredProcess(
      { ...confirmedIdentity(42), processGroupId: 21 },
      new AbortController().signal,
    ),
  ).resolves.toEqual({ status: 'terminated' });
  expect(signalled).toEqual([[84, 'SIGTERM']]);
});

test('recovery confirms concurrent natural exit even when TERM is refused', async () => {
  const recovery = createNodeRecoveredProcessInspector(
    async (pid) => confirmedIdentity(pid),
    processGroupScenario({ termAccepted: false, goneAfterTerm: true }),
  );

  await expect(
    recovery.inspectAndReconcileRecoveredProcess(
      confirmedIdentity(42),
      new AbortController().signal,
    ),
  ).resolves.toEqual({ status: 'terminated' });
});

test('cancellation during TERM confirmation stops recovery before KILL', async () => {
  const controller = new AbortController();
  const signals: NodeJS.Signals[] = [];
  const system: ProcessGroupSystem = {
    ...processGroupScenario({ goneAfterTerm: false }),
    signal: (_pid, signal) => {
      signals.push(signal);
      return true;
    },
    wait: async () => {
      controller.abort();
    },
  };
  const recovery = createNodeRecoveredProcessInspector(
    async (pid) => confirmedIdentity(pid),
    system,
  );

  await expect(
    recovery.inspectAndReconcileRecoveredProcess(confirmedIdentity(42), controller.signal),
  ).resolves.toEqual({ status: 'termination_unconfirmed' });
  expect(signals).toEqual(['SIGTERM']);
});

test('recovery distinguishes an absent process from inconclusive inspection', async () => {
  const absent = createNodeRecoveredProcessInspector(async () => {
    throw Object.assign(new Error('gone'), { code: 'ENOENT' });
  });
  const inconclusive = createNodeRecoveredProcessInspector(async () => {
    throw new Error('inspection unavailable');
  });

  await expect(
    absent.inspectAndReconcileRecoveredProcess(confirmedIdentity(42), new AbortController().signal),
  ).resolves.toEqual({ status: 'absent' });
  await expect(
    inconclusive.inspectAndReconcileRecoveredProcess(
      confirmedIdentity(42),
      new AbortController().signal,
    ),
  ).resolves.toEqual({ status: 'inconclusive' });
});

test('recovery contains abort and signal-delivery uncertainty without using a persisted group', async () => {
  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  const inspector = createNodeRecoveredProcessInspector(
    async (pid) => confirmedIdentity(pid),
    processGroupScenario({}),
  );
  const termDenied = createNodeRecoveredProcessInspector(
    async (pid) => confirmedIdentity(pid),
    processGroupScenario({
      termAccepted: false,
      killAccepted: false,
      goneAfterTerm: false,
      goneAfterKill: false,
    }),
  );
  const killDenied = createNodeRecoveredProcessInspector(
    async (pid) => confirmedIdentity(pid),
    processGroupScenario({ goneAfterTerm: false, killAccepted: false, goneAfterKill: false }),
  );

  await expect(
    inspector.inspectAndReconcileRecoveredProcess(confirmedIdentity(42), alreadyAborted.signal),
  ).resolves.toEqual({ status: 'inconclusive' });
  await expect(
    termDenied.inspectAndReconcileRecoveredProcess(
      confirmedIdentity(42),
      new AbortController().signal,
    ),
  ).resolves.toEqual({ status: 'termination_unconfirmed' });
  await expect(
    killDenied.inspectAndReconcileRecoveredProcess(
      confirmedIdentity(42),
      new AbortController().signal,
    ),
  ).resolves.toEqual({ status: 'termination_unconfirmed' });
});

test('recovery escalates a surviving authentic group to KILL and confirms its exit', async () => {
  const killed = createNodeRecoveredProcessInspector(
    async (pid) => confirmedIdentity(pid),
    processGroupScenario({ goneAfterTerm: false, goneAfterKill: true }),
  );
  const survivesKill = createNodeRecoveredProcessInspector(
    async (pid) => confirmedIdentity(pid),
    processGroupScenario({ goneAfterTerm: false, goneAfterKill: false }),
  );

  await expect(
    killed.inspectAndReconcileRecoveredProcess(confirmedIdentity(42), new AbortController().signal),
  ).resolves.toEqual({ status: 'terminated' });
  await expect(
    survivesKill.inspectAndReconcileRecoveredProcess(
      confirmedIdentity(42),
      new AbortController().signal,
    ),
  ).resolves.toEqual({ status: 'termination_unconfirmed' });
});
