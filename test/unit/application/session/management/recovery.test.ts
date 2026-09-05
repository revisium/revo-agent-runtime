import { expect, test, vi } from 'vitest';

import { recoverAgentSessions } from '../../../../../src/application/session/management/recovery.js';
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
