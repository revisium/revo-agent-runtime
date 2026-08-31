import { expect, test, vi } from 'vitest';

import { InvocationEvents } from '../../../../src/application/manager/invocation-events.js';
import { createAgentManager as createManagedAgentManager } from '../../../../src/application/manager/manager.js';
import type { AgentEvent } from '../../../../src/contracts/manager.js';
import { AgentManagerError, createAgentManager } from '../../../../src/index.js';
import { remainsPending } from '../../../support/assertions/supervision.js';
import { withTemporaryDirectory } from '../../../support/assertions/temporary-directory.js';
import { agentDefinition } from '../../../support/builders/agent-definition.js';
import { managerServices } from '../../../support/builders/manager-services.js';
import {
  publicAgentManager as managerWith,
  publicInvocationRequest as requestFor,
} from '../../../support/builders/public-agent-manager.js';
import {
  activeExecutionStory,
  activeStateRequest,
} from '../../../support/stories/active-state-execution.js';
import { activeStateStory, noOpActiveStateSink } from '../../../support/stories/active-state.js';
import { terminalPublicationStory } from '../../../support/stories/terminal-publication.js';

const expectFault = (
  run: () => unknown,
  expected: { readonly code: string; readonly phase: string },
) => {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(AgentManagerError);
    expect(error).toMatchObject({ fault: { ...expected, retryable: false } });
    return;
  }
  throw new Error('Expected AgentManagerError.');
};

test('runs a fake ACP agent through the public manager lifecycle', async () => {
  await withTemporaryDirectory(async (directory) => {
    const events: string[] = [];
    const ignoredEvents: string[] = [];
    const manager = managerWith();

    await manager.initialize([]);
    const unsubscribe = manager.subscribe({}, ({ type }) => events.push(type));
    manager.subscribe({ invocationId: 'another-invocation' }, ({ type }) =>
      ignoredEvents.push(type),
    );
    const handle = await manager.start({
      ...requestFor(directory, 'fake-acp-invocation'),
      metadata: { source: 'contract-test' },
    });
    const result = await handle.result();

    unsubscribe();
    const firstShutdown = manager.shutdown('first shutdown reason');
    expect(manager.shutdown('ignored later reason')).toBe(firstShutdown);
    await expect(manager.initialize([])).rejects.toMatchObject({
      fault: { code: 'revo.agent.manager_closed', phase: 'manager' },
    });
    await firstShutdown;

    expect(handle.pin.agentId).toBe('codex');
    expect(result).toMatchObject({
      invocationId: 'fake-acp-invocation',
      metadata: { source: 'contract-test' },
      status: 'succeeded',
      value: { answer: 'fake ACP result' },
    });
    expect(events).toEqual(['invocation.accepted', 'invocation.started', 'invocation.finished']);
    expect(ignoredEvents).toEqual([]);
  });
});

test('settles completion before one finished event, then cleans up and publishes that event', async () => {
  const execution = activeExecutionStory();
  const state = activeStateStory();
  const publication = terminalPublicationStory();
  const finish = vi.spyOn(InvocationEvents.prototype, 'finish');
  const manager = createManagedAgentManager(
    { activeStateSink: state.sink, definitions: [agentDefinition()] },
    managerServices({ executor: execution.executor, outputPublisher: publication.publisher }),
  );
  const events: AgentEvent[] = [];
  await manager.initialize([]);
  manager.subscribe({}, (event) => events.push(event));

  try {
    const handle = await manager.start(activeStateRequest('terminal-lifecycle-order'));
    const result = handle.result();

    expect(finish).not.toHaveBeenCalled();
    execution.complete();
    await state.waitUntilRecorded(2);
    await publication.waitUntilRequested();

    expect(finish).toHaveBeenCalledTimes(1);
    expect(state.operations()).toEqual(['save:running', 'remove:terminal-lifecycle-order']);
    expect(events).toHaveLength(2);
    await expect(remainsPending(result)).resolves.toBe(true);

    const published = publication.publication();
    expect(published?.events.map(({ type }) => type)).toEqual([
      'invocation.accepted',
      'invocation.started',
      'invocation.finished',
    ]);
    const finished = published?.events.at(-1);
    expect(published?.result.finishedAt).toBe(finished?.timestamp);

    publication.release();
    await expect(result).resolves.toMatchObject({ status: 'succeeded' });
    expect(events.at(-1)).toBe(finished);
    expect(events).toHaveLength(3);
  } finally {
    publication.release();
    finish.mockRestore();
    await manager.shutdown();
  }
});

test('rejects invalid options and invalid starts before accepting an invocation', async () => {
  await withTemporaryDirectory(async (directory) => {
    expect(() => {
      Reflect.apply(createAgentManager, undefined, [undefined]);
    }).toThrow('Agent definition is invalid.');

    const manager = managerWith();
    expectFault(() => manager.subscribe({}, () => undefined), {
      code: 'revo.agent.manager_not_initialized',
      phase: 'manager',
    });
    await expect(manager.start(requestFor(directory, 'before-initialize'))).rejects.toMatchObject({
      fault: { code: 'revo.agent.manager_not_initialized', phase: 'manager' },
    });
    const firstInitialization = manager.initialize([]);
    expect(manager.initialize([])).toBe(firstInitialization);
    await firstInitialization;
    await expect(
      manager.start({
        ...requestFor(directory, 'unknown-agent'),
        agent: { id: 'unknown', version: '1' },
      }),
    ).rejects.toMatchObject({ fault: { code: 'revo.agent.agent_unknown' } });
    await manager.shutdown();
    await expect(manager.start(requestFor(directory, 'after-shutdown'))).rejects.toMatchObject({
      fault: { code: 'revo.agent.manager_closed', phase: 'manager' },
    });
    expectFault(() => manager.subscribe({}, () => undefined), {
      code: 'revo.agent.manager_closed',
      phase: 'manager',
    });
  });
});

test('rejects invalid manager and invocation deadlines at their public boundaries', async () => {
  expectFault(
    () => {
      Reflect.apply(createAgentManager, undefined, [
        {
          activeStateSink: noOpActiveStateSink,
          definitions: [agentDefinition()],
          limits: 30,
        },
      ]);
    },
    { code: 'revo.agent.limit_invalid', phase: 'construction' },
  );
  expectFault(
    () => {
      Reflect.apply(createAgentManager, undefined, [
        {
          activeStateSink: noOpActiveStateSink,
          definitions: [agentDefinition()],
          limits: { unsupportedDeadline: 1_000 },
        },
      ]);
    },
    { code: 'revo.agent.limit_invalid', phase: 'construction' },
  );
  expectFault(
    () => {
      createAgentManager({
        activeStateSink: noOpActiveStateSink,
        definitions: [agentDefinition()],
        limits: { idleTimeoutMs: 0 },
      });
    },
    { code: 'revo.agent.limit_invalid', phase: 'construction' },
  );
  expectFault(
    () => {
      createAgentManager({
        activeStateSink: noOpActiveStateSink,
        definitions: [agentDefinition()],
        limits: { idleTimeoutMs: 2_000, wallClockTimeoutMs: 1_000 },
      });
    },
    { code: 'revo.agent.limit_invalid', phase: 'construction' },
  );
  expectFault(
    () => {
      createAgentManager({
        activeStateSink: noOpActiveStateSink,
        definitions: [agentDefinition()],
        limits: { wallClockTimeoutMs: 1_800_001 },
      });
    },
    { code: 'revo.agent.limit_invalid', phase: 'construction' },
  );

  await withTemporaryDirectory(async (directory) => {
    const manager = managerWith();
    const events: string[] = [];
    await manager.initialize([]);
    manager.subscribe({}, ({ type }) => events.push(type));

    await expect(
      manager.start({
        ...requestFor(directory, 'invalid-invocation-deadline'),
        limits: { wallClockTimeoutMs: 0 },
      }),
    ).rejects.toMatchObject({
      fault: { code: 'revo.agent.limit_invalid', phase: 'preflight' },
    });

    await expect(
      manager.start({
        ...requestFor(directory, 'deadline-above-manager-policy'),
        limits: { idleTimeoutMs: 300_001 },
      }),
    ).rejects.toMatchObject({
      fault: { code: 'revo.agent.limit_invalid', phase: 'preflight' },
    });

    await expect(
      manager.start({
        ...requestFor(directory, 'incoherent-invocation-deadlines'),
        limits: { idleTimeoutMs: 2_000, wallClockTimeoutMs: 1_000 },
      }),
    ).rejects.toMatchObject({
      fault: { code: 'revo.agent.limit_invalid', phase: 'preflight' },
    });

    await manager.shutdown();
    expect(events).toEqual([]);
  });
});
