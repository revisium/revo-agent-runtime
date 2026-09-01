import { expect, test } from 'vitest';

import { type ProcessGroupSystem } from '../../../../src/platform/node/process/cleanup.js';
import { createNodeRecoveredProcessInspector } from '../../../../src/platform/node/process/recovered-process.js';

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
    processGroupScenario({ termAccepted: false }),
  );
  const killDenied = createNodeRecoveredProcessInspector(
    async (pid) => confirmedIdentity(pid),
    processGroupScenario({ goneAfterTerm: false, killAccepted: false }),
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
