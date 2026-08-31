import { access, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, expect, test, vi } from 'vitest';

import { createAgentManager } from '../../../../src/application/manager/manager.js';
import type {} from '../../../../src/execution/invocation/executor.js';
import type { RecoveredProcessInspector } from '../../../../src/execution/process/port.js';
import { nodeClaimedOutputPublisher } from '../../../../src/platform/node/output/publication.js';
import { remainsPending } from '../../../support/assertions/supervision.js';
import { withTemporaryDirectory } from '../../../support/assertions/temporary-directory.js';
import { agentDefinition } from '../../../support/builders/agent-definition.js';
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
test('publishes frozen running state before public acceptance and removes it before finish', async () => {
  const state = activeStateStory();
  const execution = activeExecutionStory();
  const running = state.holdNext('save');
  const manager = createAgentManager(
    { activeStateSink: state.sink, definitions: [agentDefinition()] },
    managerServices({ executor: execution.executor, recoveryInspector }),
  );
  const events: string[] = [];
  await manager.initialize([]);
  manager.subscribe({}, ({ type }) => events.push(type));

  const starting = manager.start(activeStateRequest('active-state-order'));

  await state.waitUntilRecorded(1);
  expect(state.operations()).toEqual(['save:running']);
  expect(events).toEqual([]);
  const snapshot = state.snapshots()[0]!;
  expect(snapshot).toMatchObject({
    invocationId: 'active-state-order',
    process: { pid: 101, processGroupId: 101 },
    state: 'running',
  });
  expect(Object.isFrozen(snapshot)).toBe(true);
  expect(Object.isFrozen(snapshot.pin)).toBe(true);
  expect(Object.isFrozen(snapshot.process)).toBe(true);
  expect(state.signals()[0]).toBeInstanceOf(AbortSignal);

  running.succeed();
  const handle = await starting;
  execution.complete();
  const result = await handle.result();

  expect(result.status).toBe('succeeded');
  expect(state.operations()).toEqual(['save:running', 'remove:active-state-order']);
  expect(events).toEqual(['invocation.accepted', 'invocation.started', 'invocation.finished']);
  await manager.shutdown();
});

test('rejects before acceptance and cleans execution when running state cannot be saved', async () => {
  const state = activeStateStory();
  state.failNext('save');
  const execution = activeExecutionStory();
  const manager = createAgentManager(
    { activeStateSink: state.sink, definitions: [agentDefinition()] },
    managerServices({ executor: execution.executor, recoveryInspector }),
  );
  const events: string[] = [];
  await manager.initialize([]);
  manager.subscribe({}, ({ type }) => events.push(type));

  await expect(manager.start(activeStateRequest('failed-running-save'))).rejects.toMatchObject({
    fault: { code: 'revo.agent.active_state_failed', phase: 'preflight' },
  });

  expect(execution.cancellations()).toBe(1);
  expect(state.operations()).toEqual(['save:running', 'remove:failed-running-save']);
  expect(events).toEqual([]);
  await manager.shutdown();
});

test('does not let a failed cancelling save delay cleanup or terminal removal', async () => {
  const state = activeStateStory();
  const execution = activeExecutionStory();
  const manager = createAgentManager(
    { activeStateSink: state.sink, definitions: [agentDefinition()] },
    managerServices({ executor: execution.executor, recoveryInspector }),
  );
  await manager.initialize([]);
  const handle = await manager.start(activeStateRequest('failed-cancelling-save'));
  state.failNext('save');

  await handle.cancel();
  const result = await handle.result();

  expect(result.status).toBe('cancelled');
  expect(state.operations()).toEqual([
    'save:running',
    'save:cancelling',
    'remove:failed-cancelling-save',
  ]);
  await manager.shutdown();
});

test('withholds terminal result and finished event until active state removal settles', async () => {
  const state = activeStateStory();
  const execution = activeExecutionStory();
  const removal = state.holdNext('remove');
  const manager = createAgentManager(
    { activeStateSink: state.sink, definitions: [agentDefinition()] },
    managerServices({ executor: execution.executor, recoveryInspector }),
  );
  const events: string[] = [];
  await manager.initialize([]);
  manager.subscribe({}, ({ type }) => events.push(type));
  const handle = await manager.start(activeStateRequest('held-remove'));

  execution.complete();
  expect(await remainsPending(handle.result())).toBe(true);
  expect(events).toEqual(['invocation.accepted', 'invocation.started']);

  removal.succeed();
  await expect(handle.result()).resolves.toMatchObject({ status: 'succeeded' });
  expect(events).toEqual(['invocation.accepted', 'invocation.started', 'invocation.finished']);
  await manager.shutdown();
});

test('publishes the filesystem result marker only after active state removal is confirmed', async () => {
  await withTemporaryDirectory(async (directory) => {
    const state = activeStateStory();
    const execution = activeExecutionStory();
    const removal = state.holdNext('remove');
    const manager = createAgentManager(
      { activeStateSink: state.sink, definitions: [agentDefinition()] },
      managerServices({
        executor: execution.executor,
        outputPublisher: nodeClaimedOutputPublisher,
        recoveryInspector,
      }),
    );
    await manager.initialize([]);
    const handle = await manager.start({
      ...activeStateRequest('filesystem-publication-order'),
      output: { directory },
    });

    execution.complete();
    await state.waitUntilRecorded(2);

    await expect(access(join(directory, 'result.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    removal.succeed();
    await expect(handle.result()).resolves.toMatchObject({ status: 'succeeded' });
    await expect(access(join(directory, 'result.json'))).resolves.toBeUndefined();
    await manager.shutdown();
  });
});

test('leaves no public output artifacts when active state removal fails', async () => {
  await withTemporaryDirectory(async (directory) => {
    const state = activeStateStory();
    const execution = activeExecutionStory();
    state.failNext('remove');
    const manager = createAgentManager(
      { activeStateSink: state.sink, definitions: [agentDefinition()] },
      managerServices({
        executor: execution.executor,
        outputPublisher: nodeClaimedOutputPublisher,
        recoveryInspector,
      }),
    );
    await manager.initialize([]);
    const handle = await manager.start({
      ...activeStateRequest('failed-remove-publication'),
      output: { directory },
    });

    execution.complete();

    expect(await remainsPending(handle.result())).toBe(true);
    expect(await readdir(directory)).toEqual([]);
    await expect(manager.shutdown()).rejects.toMatchObject({
      fault: { code: 'revo.agent.shutdown_failed' },
    });
  });
});
