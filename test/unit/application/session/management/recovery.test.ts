import { afterEach, expect, test, vi } from 'vitest';

import {
  beginAgentSessionRecovery,
  recoverAgentSessions,
} from '../../../../../src/application/session/management/recovery.js';
import type {
  RecoveredProcessInspector,
  RecoveredProcessReconciliation,
} from '../../../../../src/execution/process/port.js';
import type {
  AgentDescriptor,
  ActiveAgentSessionSnapshot,
  ActiveAgentSessionStateSink,
} from '../../../../../src/index.js';

const definitionDigest = 'a'.repeat(64);

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const agent: AgentDescriptor = {
  agent: { id: 'fake', version: '1.0.0' },
  capabilities: { cancellation: true, structuredResult: true, usage: false },
  definitionDigest,
  displayName: 'Fake',
};

const snapshot = (
  sessionId: string,
  overrides: Partial<ActiveAgentSessionSnapshot> = {},
): ActiveAgentSessionSnapshot => ({
  acceptedAt: '2026-09-05T00:00:00.000Z',
  incarnationId: `inc-${sessionId}`,
  pin: { agentId: 'fake', agentVersion: '1.0.0', definitionDigest },
  process: {
    fingerprint: `sha256:${'b'.repeat(64)}`,
    pid: 101,
    processGroupId: 101,
    startedAt: '2026-09-05T00:00:01.000Z',
  },
  sessionId,
  state: 'idle',
  ...overrides,
});

const setup = (outcomes: readonly RecoveredProcessReconciliation[]) => {
  const inspected: ActiveAgentSessionSnapshot['process'][] = [];
  const removed: { incarnationId: string; sessionId: string }[] = [];
  const inspector: RecoveredProcessInspector = {
    inspectAndReconcileRecoveredProcess: async (identity) => {
      inspected.push(identity);
      const outcome = outcomes[inspected.length - 1];
      if (outcome === undefined) throw new Error('Missing recovery outcome.');
      return outcome;
    },
  };
  const sink: ActiveAgentSessionStateSink = {
    remove: async (identity) => {
      removed.push(identity);
      return { state: 'applied' };
    },
    save: async () => ({ state: 'applied' }),
  };
  const recover = (snapshots: readonly ActiveAgentSessionSnapshot[]) =>
    recoverAgentSessions({
      agents: [agent],
      inspector,
      operationTimeoutMs: 100,
      recoveryTimeoutMs: 500,
      sink,
      snapshots,
    });
  return { inspected, recover, removed, sink };
};

test('reconciles only confirmed-safe recovered processes and removes their owned rows', async () => {
  const story = setup([
    { status: 'absent' },
    { status: 'identity_mismatch' },
    { status: 'terminated' },
  ]);
  const snapshots = [snapshot('absent'), snapshot('reused'), snapshot('terminated')];

  await story.recover(snapshots);

  expect(story.inspected).toEqual(snapshots.map(({ process }) => process));
  expect(story.removed).toEqual(
    snapshots.map(({ incarnationId, sessionId }) => ({ incarnationId, sessionId })),
  );
});

test.each(['inconclusive', 'termination_unconfirmed'] as const)(
  'retains a row when process reconciliation is %s',
  async (status) => {
    const story = setup([{ status }]);

    await expect(story.recover([snapshot('unsafe')])).rejects.toMatchObject({
      fault: { code: 'revo.agent.session_state_unavailable', phase: 'session_recovery' },
    });
    expect(story.removed).toEqual([]);
  },
);

test('fails closed when owner-fenced removal reports another owner', async () => {
  const story = setup([{ status: 'absent' }]);
  vi.spyOn(story.sink, 'remove').mockResolvedValue({ state: 'not_owner' });

  await expect(story.recover([snapshot('ownership-race')])).rejects.toMatchObject({
    fault: { code: 'revo.agent.session_state_unavailable' },
  });
});

test.each([
  { label: 'not an array', snapshots: null },
  { label: 'non-record row', snapshots: [1] },
  {
    label: 'duplicate identity',
    snapshots: [snapshot('duplicate'), snapshot('duplicate')],
  },
  {
    label: 'unknown definition pin',
    snapshots: [
      snapshot('bad-pin', {
        pin: { agentId: 'fake', agentVersion: '1.0.0', definitionDigest: 'c'.repeat(64) },
      }),
    ],
  },
  {
    label: 'invalid process identity',
    snapshots: [snapshot('bad-process', { process: { ...snapshot('source').process, pid: 0 } })],
  },
])('rejects untrusted recovery input: $label', async ({ snapshots }) => {
  const story = setup([]);

  await expect(Reflect.apply(story.recover, undefined, [snapshots])).rejects.toMatchObject({
    fault: { code: 'revo.agent.session_state_unavailable' },
  });
  expect(story.inspected).toEqual([]);
  expect(story.removed).toEqual([]);
});

test('accepts an empty recovery set without touching external ports', async () => {
  const story = setup([]);

  await expect(story.recover([])).resolves.toBeUndefined();
  expect(story.inspected).toEqual([]);
  expect(story.removed).toEqual([]);
});

test.each(['inspection', 'removal'] as const)(
  'contains a thrown %s port failure',
  async (phase) => {
    const story = setup([{ status: 'absent' }]);
    if (phase === 'removal') vi.spyOn(story.sink, 'remove').mockRejectedValue(new Error('failure'));

    const inspector: RecoveredProcessInspector = {
      inspectAndReconcileRecoveredProcess:
        phase === 'inspection'
          ? async () => {
              throw new Error('failure');
            }
          : async () => ({ status: 'absent' }),
    };
    await expect(
      recoverAgentSessions({
        agents: [agent],
        inspector,
        operationTimeoutMs: 100,
        recoveryTimeoutMs: 500,
        sink: story.sink,
        snapshots: [snapshot('port-failure')],
      }),
    ).rejects.toMatchObject({ fault: { code: 'revo.agent.session_state_unavailable' } });
  },
);

test('reports timeout immediately but keeps quiescence pending until the port settles', async () => {
  vi.useFakeTimers();
  const inspection = Promise.withResolvers<RecoveredProcessReconciliation>();
  const attempt = beginAgentSessionRecovery({
    agents: [agent],
    inspector: { inspectAndReconcileRecoveredProcess: async () => inspection.promise },
    operationTimeoutMs: 100,
    recoveryTimeoutMs: 500,
    sink: setup([]).sink,
    snapshots: [snapshot('timeout')],
  });
  let quiescent = false;
  void attempt.quiescence.then(() => {
    quiescent = true;
  });

  await vi.advanceTimersByTimeAsync(101);
  await expect(attempt.result).rejects.toMatchObject({
    fault: { code: 'revo.agent.session_state_unavailable' },
  });
  expect(quiescent).toBe(false);
  inspection.resolve({ status: 'absent' });
  await attempt.quiescence;
  expect(quiescent).toBe(true);
  vi.useRealTimers();
});

test('fails closed when the global recovery deadline expires before removal', async () => {
  const now = vi
    .spyOn(Date, 'now')
    .mockReturnValueOnce(0)
    .mockReturnValueOnce(0)
    .mockReturnValue(501);
  const story = setup([{ status: 'absent' }]);

  await expect(story.recover([snapshot('deadline')])).rejects.toMatchObject({
    fault: { code: 'revo.agent.session_state_unavailable' },
  });
  expect(story.removed).toEqual([]);
  now.mockRestore();
});

test('fails closed when the global deadline expires before process inspection', async () => {
  vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(501);
  const story = setup([{ status: 'absent' }]);
  await expect(story.recover([snapshot('expired-before-inspection')])).rejects.toMatchObject({
    fault: { code: 'revo.agent.session_state_unavailable' },
  });
  expect(story.inspected).toEqual([]);
});
