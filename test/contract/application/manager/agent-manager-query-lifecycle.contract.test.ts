import { expect, test, vi } from 'vitest';

import type { AgentRef } from '../../../../src/contracts/agent-definition.js';
import { AgentManagerError, type AgentManager } from '../../../../src/contracts/manager.js';
import { InvocationQueryStory as InvocationStory } from '../../../support/stories/invocation-query-story.js';

const expectManagerFault = async (
  operation: Promise<unknown> | (() => unknown),
  code: string,
): Promise<void> => {
  try {
    if (typeof operation === 'function') operation();
    else await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(AgentManagerError);
    if (!(error instanceof AgentManagerError)) throw error;
    expect(error.fault.code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code}.`);
};

const getAgentUnchecked = (manager: AgentManager, agent: unknown): unknown => {
  const result: unknown = Reflect.apply(
    (checked: AgentRef) => manager.getAgent(checked),
    undefined,
    [agent],
  );
  return result;
};

test('sealed agent reads stay deterministic before readiness and after shutdown', async () => {
  const story = new InvocationStory();

  expect(story.manager.listAgents().map(({ agent }) => agent)).toEqual([
    { id: 'alpha', version: '2.0.0' },
    { id: 'zeta', version: '1.0.0' },
  ]);
  expect(story.manager.getAgent({ id: 'zeta', version: '1.0.0' })).toMatchObject({
    description: 'A second agent.',
    displayName: 'Zeta',
  });
  expect(story.manager.getAgent({ id: 'missing', version: '1.0.0' })).toBeUndefined();
  expect(Object.isFrozen(story.manager.listAgents())).toBe(true);
  expect(Object.isFrozen(story.manager.listAgents()[0]?.agent)).toBe(true);
  expect(Object.isFrozen(story.manager.listAgents()[0]?.capabilities)).toBe(true);
  const hostileAgent = new Proxy(
    {},
    {
      ownKeys: () => {
        throw new Error('Caller trap.');
      },
    },
  );
  expect(getAgentUnchecked(story.manager, hostileAgent)).toBeUndefined();

  await story.manager.shutdown();

  expect(story.manager.listAgents()).toHaveLength(2);
  expect(story.manager.getAgent({ id: 'alpha', version: '2.0.0' })?.displayName).toBe('Alpha');
});

test('process-local reads require successful initialization', async () => {
  const story = new InvocationStory();

  await expectManagerFault(
    () => story.manager.listInvocations(),
    'revo.agent.manager_not_initialized',
  );
  await expectManagerFault(
    () => story.manager.getInvocation('unknown'),
    'revo.agent.manager_not_initialized',
  );
  await expectManagerFault(
    () => story.manager.getResult('unknown'),
    'revo.agent.manager_not_initialized',
  );
  await expectManagerFault(
    () => story.manager.waitForResult('unknown'),
    'revo.agent.manager_not_initialized',
  );
});

test('query methods expose one active snapshot and the same retained result', async () => {
  const story = await new InvocationStory().ready();
  let resultVisibleAtFinishedEvent = false;
  story.manager.subscribe({ types: ['invocation.finished'] }, ({ invocationId }) => {
    resultVisibleAtFinishedEvent = story.manager.getResult(invocationId).state === 'completed';
  });

  const handle = await story.start('reader-visible');
  const waiting = story.manager.waitForResult(handle.invocationId);

  expect(story.manager.getResult(handle.invocationId)).toMatchObject({
    invocation: { invocationId: handle.invocationId, status: 'running' },
    state: 'running',
  });
  expect(story.manager.listInvocations({ statuses: ['running'] })).toHaveLength(1);
  expect(story.manager.listInvocations({ invocationId: 'another-invocation' })).toEqual([]);
  expect(story.manager.listInvocations({ agent: { id: 'zeta', version: '1.0.0' } })).toEqual([]);
  expect(story.manager.listInvocations({ statuses: ['failed'] })).toEqual([]);
  const activeSnapshot = story.manager.getInvocation(handle.invocationId);
  expect(Object.isFrozen(activeSnapshot)).toBe(true);
  expect(Object.isFrozen(activeSnapshot?.metadata)).toBe(true);
  expect(Object.isFrozen(activeSnapshot?.pin)).toBe(true);

  story.complete(handle.invocationId, { answer: 42 });
  const result = await handle.result();

  expect(await waiting).toBe(result);
  expect(story.manager.getResult(handle.invocationId)).toEqual({ state: 'completed', result });
  expect(await story.manager.waitForResult(handle.invocationId)).toBe(result);
  const completedSnapshot = story.manager.getInvocation(handle.invocationId);
  expect(completedSnapshot).toMatchObject({
    invocationId: handle.invocationId,
    status: 'succeeded',
  });
  expect(typeof completedSnapshot?.finishedAt).toBe('string');
  expect(Object.isFrozen(story.manager.listInvocations())).toBe(true);
  expect(Object.isFrozen(result)).toBe(true);
  expect(resultVisibleAtFinishedEvent).toBe(true);
});

test('accepted event reentrancy can cancel the already-owned invocation', async () => {
  const story = await new InvocationStory().ready();
  story.manager.subscribe({ types: ['invocation.accepted'] }, ({ invocationId }) => {
    void story.manager.cancel(invocationId);
  });

  const handle = await story.start('cancel-from-accepted-listener');

  await expect(handle.result()).resolves.toMatchObject({ status: 'cancelled' });
  expect(story.manager.getResult(handle.invocationId)).toMatchObject({
    result: { status: 'cancelled' },
    state: 'completed',
  });
});

test('retention evicts snapshot and result together while reads remain available after close', async () => {
  const story = await new InvocationStory().ready();
  const first = await story.start('first');
  story.complete('first');
  await first.result();
  const second = await story.start('second');
  story.complete('second');
  const secondResult = await second.result();

  await story.manager.shutdown();

  expect(story.manager.getInvocation('first')).toBeUndefined();
  expect(story.manager.getResult('first')).toEqual({ state: 'unknown' });
  await expectManagerFault(story.manager.waitForResult('first'), 'revo.agent.invocation_unknown');
  expect(story.manager.getResult('second')).toEqual({ state: 'completed', result: secondResult });
});

test('retention chooses the oldest finished timestamp and invocation id, not completion arrival', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-30T12:00:00.000Z'));
  try {
    const story = await new InvocationStory().ready();
    const alpha = await story.start('alpha');
    const zeta = await story.start('zeta');

    story.complete('zeta');
    await zeta.result();
    story.complete('alpha');
    await alpha.result();

    expect(story.manager.getResult('alpha')).toEqual({ state: 'unknown' });
    expect(story.manager.getResult('zeta')).toMatchObject({ state: 'completed' });
  } finally {
    vi.useRealTimers();
  }
});
