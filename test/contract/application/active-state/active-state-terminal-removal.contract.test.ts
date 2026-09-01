import { afterEach, expect, test, vi } from 'vitest';

import { createAgentManager } from '../../../../src/application/manager/manager.js';
import type { InvocationExecutor } from '../../../../src/execution/invocation/executor.js';
import type { RecoveredProcessInspector } from '../../../../src/execution/process/port.js';
import { captureRejection, remainsPending } from '../../../support/assertions/supervision.js';
import { agentDefinition } from '../../../support/builders/agent-definition.js';
import { acceptedAdmission } from '../../../support/builders/execution-evidence.js';
import { managerServices } from '../../../support/builders/manager-services.js';
import {
  activeExecutionStory,
  activeStateRequest,
} from '../../../support/stories/active-state-execution.js';
import { activeStateStory } from '../../../support/stories/active-state.js';

const recoveryInspector: RecoveredProcessInspector = {
  inspectAndReconcileRecoveredProcess: async () => ({ status: 'absent' }),
};

afterEach(() => vi.useRealTimers());
test('replays cancellation observed during admission after the running state save', async () => {
  const state = activeStateStory();
  const running = state.holdNext('save');
  const execution = activeExecutionStory('controlled');
  const cancellation = new AbortController();
  const manager = createAgentManager(
    { activeStateSink: state.sink, definitions: [agentDefinition()] },
    managerServices({ executor: execution.executor, recoveryInspector }),
  );
  await manager.initialize([]);

  const starting = manager.start(activeStateRequest('cancelled-during-admission'), {
    signal: cancellation.signal,
  });
  await execution.waitUntilExecutionStarted();
  const rejection = captureRejection(starting);
  cancellation.abort();
  await execution.acceptProcess();
  await state.waitUntilRecorded(1);
  expect(state.operations()).toEqual(['save:running']);

  running.succeed();
  expect(await rejection).toMatchObject({ fault: { code: 'revo.agent.cancelled' } });
  expect(state.operations()).toEqual([
    'save:running',
    'save:cancelling',
    'remove:cancelled-during-admission',
  ]);
  await manager.shutdown();
});

test('retains a nonterminal invocation when removal rejects and reports shutdown failure', async () => {
  const state = activeStateStory();
  const execution = activeExecutionStory();
  const manager = createAgentManager(
    { activeStateSink: state.sink, definitions: [agentDefinition()] },
    managerServices({ executor: execution.executor, recoveryInspector }),
  );
  const events: string[] = [];
  await manager.initialize([]);
  manager.subscribe({}, ({ type }) => events.push(type));
  const handle = await manager.start(activeStateRequest('rejected-remove'));
  state.failNext('remove');

  execution.complete();
  expect(await remainsPending(handle.result())).toBe(true);
  expect(events).toEqual(['invocation.accepted', 'invocation.started']);
  await expect(manager.shutdown()).rejects.toMatchObject({
    fault: { code: 'revo.agent.shutdown_failed', phase: 'shutdown' },
  });
});

test('reserves an id through unknown running-save quiescence and releases it only after removal', async () => {
  vi.useFakeTimers();
  const state = activeStateStory();
  const lateSave = state.holdNext('save');
  const execution = activeExecutionStory();
  const manager = createAgentManager(
    {
      activeStateSink: state.sink,
      definitions: [agentDefinition()],
      limits: { activeStateOperationTimeoutMs: 100, initializationTimeoutMs: 1_000 },
    },
    managerServices({ executor: execution.executor, recoveryInspector }),
  );
  await manager.initialize([]);

  const first = manager.start(activeStateRequest('late-running-save'));
  const firstRejection = expect(first).rejects.toMatchObject({
    fault: { code: 'revo.agent.active_state_failed', phase: 'preflight' },
  });
  await state.waitUntilRecorded(1);
  await vi.advanceTimersByTimeAsync(300);
  await firstRejection;
  await expect(manager.start(activeStateRequest('late-running-save'))).rejects.toMatchObject({
    fault: { code: 'revo.agent.invocation_duplicate' },
  });

  lateSave.succeed();
  await state.waitUntilRecorded(2);
  await vi.runAllTimersAsync();
  await Promise.resolve();
  const reused = await manager.start(activeStateRequest('late-running-save'));
  await expect(reused.result()).resolves.toMatchObject({ status: 'cancelled' });
  await manager.shutdown();
});

test('accepts a confirmed late removal but never publishes while removal is unknown', async () => {
  vi.useFakeTimers();
  const state = activeStateStory();
  const lateRemoval = state.holdNext('remove');
  const execution = activeExecutionStory();
  const manager = createAgentManager(
    {
      activeStateSink: state.sink,
      definitions: [agentDefinition()],
      limits: { activeStateOperationTimeoutMs: 100, initializationTimeoutMs: 1_000 },
    },
    managerServices({ executor: execution.executor, recoveryInspector }),
  );
  await manager.initialize([]);
  const handle = await manager.start(activeStateRequest('late-remove'));
  execution.complete();
  await state.waitUntilRecorded(2);

  await vi.advanceTimersByTimeAsync(100);
  lateRemoval.succeed();
  await expect(handle.result()).resolves.toMatchObject({ status: 'succeeded' });
  await manager.shutdown();
});

test('reports process cleanup uncertainty ahead of a failed running-state save', async () => {
  const state = activeStateStory();
  state.failNext('save');
  const executor: InvocationExecutor = {
    start: (request) => ({
      admission: Promise.resolve(acceptedAdmission(request)),
      completion: new Promise(() => undefined),
      drainage: Promise.resolve({ status: 'cleanup_uncertain' }),
      activate: () => undefined,
      cancel: () => true,
      evidence: () => undefined,
    }),
  };
  const manager = createAgentManager(
    { activeStateSink: state.sink, definitions: [agentDefinition()] },
    managerServices({ executor, recoveryInspector }),
  );
  await manager.initialize([]);

  await expect(manager.start(activeStateRequest('state-and-cleanup-failed'))).rejects.toMatchObject(
    {
      fault: { code: 'revo.agent.process_cleanup_failed' },
    },
  );
  await expect(manager.shutdown()).rejects.toMatchObject({
    fault: { code: 'revo.agent.shutdown_failed' },
  });
});

test('releases a preacceptance reservation after a confirmed late removal', async () => {
  vi.useFakeTimers();
  const state = activeStateStory();
  state.failNext('save');
  const lateRemoval = state.holdNext('remove');
  const manager = createAgentManager(
    {
      activeStateSink: state.sink,
      definitions: [agentDefinition()],
      limits: { activeStateOperationTimeoutMs: 100, initializationTimeoutMs: 1_000 },
    },
    managerServices({ executor: activeExecutionStory().executor, recoveryInspector }),
  );
  await manager.initialize([]);

  const starting = manager.start(activeStateRequest('late-preaccept-remove'));
  const rejection = expect(starting).rejects.toMatchObject({
    fault: { code: 'revo.agent.active_state_failed' },
  });
  await state.waitUntilRecorded(2);
  await vi.advanceTimersByTimeAsync(100);
  lateRemoval.succeed();

  await rejection;
  await manager.shutdown();
});
