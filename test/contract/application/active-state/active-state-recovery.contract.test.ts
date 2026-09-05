import { afterEach, expect, test, vi } from 'vitest';

import { createAgentManager } from '../../../../src/application/manager/manager.js';
import { agentDefinition } from '../../../support/builders/agent-definition.js';
import { managerServices } from '../../../support/builders/manager-services.js';
import { activeExecutionStory } from '../../../support/stories/active-state-execution.js';
import { activeStateStory, noOpActiveStateSink } from '../../../support/stories/active-state.js';
import { recoverySnapshot, recoveryStory } from '../../../support/stories/recovery.js';

afterEach(() => vi.useRealTimers());

const initializeWithUntrustedSnapshots = (
  manager: ReturnType<typeof createAgentManager>,
  snapshots: unknown,
): Promise<void> =>
  (async () => {
    await Reflect.apply(
      (value: readonly ReturnType<typeof recoverySnapshot>[]) => manager.initialize(value),
      undefined,
      [snapshots],
    );
  })();

test('reconciles absent, identity-mismatched, and terminated recovery rows by removal', async () => {
  const state = activeStateStory();
  const recovery = recoveryStory();
  recovery.observe('absent');
  recovery.observe('identity_mismatch');
  recovery.observe('terminated');
  const manager = createAgentManager(
    { activeStateSink: state.sink, definitions: [agentDefinition()] },
    managerServices({
      executor: activeExecutionStory().executor,
      recoveryInspector: recovery.inspector,
    }),
  );

  await manager.initialize([
    recoverySnapshot('absent-row'),
    recoverySnapshot('reused-pid-row'),
    recoverySnapshot('terminated-row'),
  ]);

  expect(state.operations()).toEqual([
    'remove:absent-row',
    'remove:reused-pid-row',
    'remove:terminated-row',
  ]);
  expect(recovery.signals()).toHaveLength(3);
  expect(new Set(recovery.signals()).size).toBe(3);
  await manager.shutdown();
});

test.each(['inconclusive', 'termination_unconfirmed'] as const)(
  'retains a %s recovery row and fails initialization closed',
  async (status) => {
    const state = activeStateStory();
    const recovery = recoveryStory();
    recovery.observe(status);
    const manager = createAgentManager(
      { activeStateSink: state.sink, definitions: [agentDefinition()] },
      managerServices({
        executor: activeExecutionStory().executor,
        recoveryInspector: recovery.inspector,
      }),
    );

    await expect(manager.initialize([recoverySnapshot(`${status}-row`)])).rejects.toMatchObject({
      fault: { code: 'revo.agent.active_state_failed', phase: 'manager' },
    });

    expect(state.operations()).toEqual([]);
    await manager.shutdown();
  },
);

test('a failed recovery attempt is retryable on the same manager after quiescence', async () => {
  const state = activeStateStory();
  const recovery = recoveryStory();
  recovery.observe('inconclusive');
  recovery.observe('absent');
  const manager = createAgentManager(
    { activeStateSink: state.sink, definitions: [agentDefinition()] },
    managerServices({
      executor: activeExecutionStory().executor,
      recoveryInspector: recovery.inspector,
    }),
  );

  const first = manager.initialize([recoverySnapshot('retry-row')]);
  expect(manager.initialize([recoverySnapshot('ignored-concurrent-row')])).toBe(first);
  await expect(first).rejects.toMatchObject({
    fault: { code: 'revo.agent.active_state_failed' },
  });
  await Promise.resolve();

  await manager.initialize([recoverySnapshot('retry-row')]);
  expect(state.operations()).toEqual(['remove:retry-row']);
  await manager.shutdown();
});

test.each([
  { label: 'not an array', snapshots: null },
  { label: 'structured input without invocations', snapshots: { sessions: [] } },
  {
    label: 'structured input with an unexpected key',
    snapshots: { extra: true, invocations: [] },
  },
  {
    label: 'structured input with an accessor',
    snapshots: Object.defineProperty({ sessions: [] }, 'invocations', {
      enumerable: true,
      get: () => [],
    }),
  },
  {
    label: 'hostile structured input proxy',
    snapshots: new Proxy(
      { invocations: [] },
      {
        ownKeys: () => {
          throw new Error('hostile initialization');
        },
      },
    ),
  },
  {
    label: 'duplicate invocation ids',
    snapshots: [recoverySnapshot('duplicate'), recoverySnapshot('duplicate')],
  },
  {
    label: 'definition digest mismatch',
    snapshots: [
      recoverySnapshot('bad-pin', {
        pin: {
          ...recoverySnapshot('source').pin,
          definitionDigest: '0'.repeat(64),
        },
      }),
    ],
  },
  {
    label: 'invalid process identity',
    snapshots: [
      recoverySnapshot('bad-process', {
        process: { ...recoverySnapshot('source').process, pid: 0 },
      }),
    ],
  },
])('rejects malformed recovery input: $label', async ({ snapshots }) => {
  const state = activeStateStory();
  const manager = createAgentManager(
    { activeStateSink: state.sink, definitions: [agentDefinition()] },
    managerServices({ executor: activeExecutionStory().executor }),
  );

  await expect(initializeWithUntrustedSnapshots(manager, snapshots)).rejects.toMatchObject({
    fault: { code: 'revo.agent.active_state_failed', phase: 'manager' },
  });
  await Promise.resolve();
  await manager.initialize([]);
  await manager.shutdown();
});

test.each([
  {
    label: 'oversized list',
    snapshots: Array.from({ length: 1_001 }, () => recoverySnapshot('x')),
  },
  { label: 'non-record row', snapshots: [1] },
  { label: 'unexpected row key', snapshots: [{ ...recoverySnapshot('extra'), extra: true }] },
  {
    label: 'accessor row field',
    snapshots: [
      Object.defineProperty({ ...recoverySnapshot('accessor') }, 'state', {
        enumerable: true,
        get: () => 'running',
      }),
    ],
  },
  {
    label: 'hostile row proxy',
    snapshots: [
      new Proxy(recoverySnapshot('proxy'), {
        ownKeys: () => {
          throw new Error('hostile snapshot');
        },
      }),
    ],
  },
  { label: 'empty invocation id', snapshots: [recoverySnapshot('source', { invocationId: '' })] },
  {
    label: 'nul invocation id',
    snapshots: [recoverySnapshot('source', { invocationId: 'bad\u0000id' })],
  },
  {
    label: 'oversized invocation id',
    snapshots: [recoverySnapshot('source', { invocationId: 'x'.repeat(257) })],
  },
  {
    label: 'invalid state',
    snapshots: [{ ...recoverySnapshot('bad-state'), state: 'stopped' }],
  },
  {
    label: 'invalid definition id',
    snapshots: [
      recoverySnapshot('bad-agent', {
        pin: { ...recoverySnapshot('source').pin, agentId: '' },
      }),
    ],
  },
  {
    label: 'invalid digest syntax',
    snapshots: [
      recoverySnapshot('bad-digest', {
        pin: { ...recoverySnapshot('source').pin, definitionDigest: 'not-a-digest' },
      }),
    ],
  },
  {
    label: 'invalid process group',
    snapshots: [
      recoverySnapshot('bad-group', {
        process: { ...recoverySnapshot('source').process, processGroupId: 0 },
      }),
    ],
  },
  {
    label: 'invalid fingerprint',
    snapshots: [
      recoverySnapshot('bad-fingerprint', {
        process: { ...recoverySnapshot('source').process, fingerprint: 'sha256:nope' },
      }),
    ],
  },
  {
    label: 'invalid started timestamp',
    snapshots: [
      recoverySnapshot('bad-started-at', {
        process: { ...recoverySnapshot('source').process, startedAt: 'yesterday' },
      }),
    ],
  },
  {
    label: 'non-string started timestamp',
    snapshots: [
      {
        ...recoverySnapshot('bad-started-at-type'),
        process: {
          ...recoverySnapshot('source').process,
          startedAt: 1,
        },
      },
    ],
  },
])('contains additional untrusted recovery shape: $label', async ({ snapshots }) => {
  const manager = createAgentManager(
    {
      activeStateSink: noOpActiveStateSink,
      definitions: [agentDefinition()],
    },
    managerServices({ executor: activeExecutionStory().executor }),
  );

  await expect(initializeWithUntrustedSnapshots(manager, snapshots)).rejects.toMatchObject({
    fault: { code: 'revo.agent.active_state_failed' },
  });
  await manager.shutdown();
});
