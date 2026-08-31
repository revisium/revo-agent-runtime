import { afterEach, expect, test, vi } from 'vitest';

import { createAgentManager } from '../../../../src/application/manager/manager.js';
import { agentDefinition } from '../../../support/builders/agent-definition.js';
import {
  managerServices,
  unavailableRecoveryInspector,
} from '../../../support/builders/manager-services.js';
import { activeExecutionStory } from '../../../support/stories/active-state-execution.js';
import { activeStateStory, noOpActiveStateSink } from '../../../support/stories/active-state.js';
import { recoverySnapshot, recoveryStory } from '../../../support/stories/recovery.js';

afterEach(() => vi.useRealTimers());

test('accepts and freezes an authentic cancelling recovery snapshot', async () => {
  const state = activeStateStory();
  const recovery = recoveryStory();
  recovery.observe('absent');
  const manager = createAgentManager(
    { activeStateSink: state.sink, definitions: [agentDefinition()] },
    managerServices({
      executor: activeExecutionStory().executor,
      recoveryInspector: recovery.inspector,
    }),
  );

  await manager.initialize([recoverySnapshot('cancelling-row', { state: 'cancelling' })]);
  expect(state.operations()).toEqual(['remove:cancelling-row']);
  await manager.shutdown();
});

test('keeps a timed-out recovery attempt closed until its late inspection settles', async () => {
  vi.useFakeTimers();
  const state = activeStateStory();
  const recovery = recoveryStory();
  const late = recovery.holdNext();
  const manager = createAgentManager(
    {
      activeStateSink: state.sink,
      definitions: [agentDefinition()],
      limits: { activeStateOperationTimeoutMs: 100, initializationTimeoutMs: 1_000 },
    },
    managerServices({
      executor: activeExecutionStory().executor,
      recoveryInspector: recovery.inspector,
    }),
  );

  const first = manager.initialize([recoverySnapshot('late-inspection')]);
  await recovery.waitUntilInspected(1);
  await vi.advanceTimersByTimeAsync(1_000);
  await expect(first).rejects.toMatchObject({ fault: { code: 'revo.agent.active_state_failed' } });
  expect(recovery.signals()[0]!.aborted).toBe(true);
  expect(manager.initialize([])).toBe(first);

  late.settle('absent');
  await vi.runAllTimersAsync();
  await Promise.resolve();
  await manager.initialize([]);
  await manager.shutdown();
});

test('shutdown fails closed while a timed-out recovery inspection can still settle late', async () => {
  vi.useFakeTimers();
  const recovery = recoveryStory();
  const late = recovery.holdNext();
  const manager = createAgentManager(
    {
      activeStateSink: noOpActiveStateSink,
      definitions: [agentDefinition()],
      limits: { activeStateOperationTimeoutMs: 100, initializationTimeoutMs: 1_000 },
    },
    managerServices({
      executor: activeExecutionStory().executor,
      recoveryInspector: recovery.inspector,
    }),
  );

  const initialization = manager.initialize([recoverySnapshot('shutdown-recovery')]);
  const rejected = expect(initialization).rejects.toMatchObject({
    fault: { code: 'revo.agent.active_state_failed' },
  });
  await recovery.waitUntilInspected(1);
  await vi.advanceTimersByTimeAsync(1_000);
  await rejected;

  await expect(manager.shutdown()).rejects.toMatchObject({
    fault: { code: 'revo.agent.shutdown_failed', phase: 'shutdown' },
  });
  late.settle('absent');
  await vi.runAllTimersAsync();
});

test.each(['throw', 'reject'] as const)(
  'contains a recovery inspector that %s without leaking its error',
  async (failure) => {
    const state = activeStateStory();
    const inspector = {
      inspectAndReconcileRecoveredProcess: () => {
        if (failure === 'throw') throw new Error('private inspector failure');
        return Promise.reject(new Error('private inspector failure'));
      },
    };
    const manager = createAgentManager(
      { activeStateSink: state.sink, definitions: [agentDefinition()] },
      managerServices({ executor: activeExecutionStory().executor, recoveryInspector: inspector }),
    );

    await expect(
      manager.initialize([recoverySnapshot(`inspector-${failure}`)]),
    ).rejects.toMatchObject({
      fault: {
        code: 'revo.agent.active_state_failed',
        message: 'Agent active state could not be saved.',
      },
    });
    await manager.shutdown();
  },
);

test('fails recovery when stale-row removal rejects and retries after the lane settles', async () => {
  const state = activeStateStory();
  state.failNext('remove');
  const recovery = recoveryStory();
  recovery.observe('absent');
  recovery.observe('absent');
  const manager = createAgentManager(
    { activeStateSink: state.sink, definitions: [agentDefinition()] },
    managerServices({
      executor: activeExecutionStory().executor,
      recoveryInspector: recovery.inspector,
    }),
  );

  await expect(manager.initialize([recoverySnapshot('remove-retry')])).rejects.toMatchObject({
    fault: { code: 'revo.agent.active_state_failed' },
  });
  await Promise.resolve();
  await manager.initialize([recoverySnapshot('remove-retry')]);

  expect(state.operations()).toEqual(['remove:remove-retry', 'remove:remove-retry']);
  await manager.shutdown();
});

test('applies the initialization deadline after each serialized recovery row', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const recovery = recoveryStory();
  recovery.observe('absent');
  const manager = createAgentManager(
    {
      activeStateSink: {
        remove: async () => {
          vi.setSystemTime(2_000);
        },
        save: async () => undefined,
      },
      definitions: [agentDefinition()],
      limits: { activeStateOperationTimeoutMs: 100, initializationTimeoutMs: 1_000 },
    },
    managerServices({
      executor: activeExecutionStory().executor,
      recoveryInspector: recovery.inspector,
    }),
  );

  await expect(manager.initialize([recoverySnapshot('overall-deadline')])).rejects.toMatchObject({
    fault: { code: 'revo.agent.active_state_failed' },
  });
  await manager.shutdown();
});

test('uses the failed-closed recovery inspector when no platform service is composed', async () => {
  const manager = createAgentManager(
    {
      activeStateSink: noOpActiveStateSink,
      definitions: [agentDefinition()],
    },
    managerServices({
      executor: activeExecutionStory().executor,
      recoveryInspector: unavailableRecoveryInspector,
    }),
  );

  await expect(manager.initialize([recoverySnapshot('uncomposed-recovery')])).rejects.toMatchObject(
    {
      fault: { code: 'revo.agent.active_state_failed' },
    },
  );
  await manager.shutdown();
});
