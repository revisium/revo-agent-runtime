import { expect, test, vi } from 'vitest';

import {
  AgentManagerError,
  type AgentEventFilter,
  type AgentEventListener,
  type AgentInvocationFilter,
  type AgentInvocationResult,
  type AgentManager,
} from '../../../../src/contracts/manager.js';
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

const listInvocationsUnchecked = (manager: AgentManager, filter: unknown): unknown => {
  const result: unknown = Reflect.apply(
    (checked: AgentInvocationFilter) => manager.listInvocations(checked),
    undefined,
    [filter],
  );
  return result;
};

const subscribeUnchecked = (manager: AgentManager, filter: unknown, listener: unknown): unknown => {
  const result: unknown = Reflect.apply(
    (checkedFilter: AgentEventFilter, checkedListener: AgentEventListener) =>
      manager.subscribe(checkedFilter, checkedListener),
    undefined,
    [filter, listener],
  );
  return result;
};
test('invocation filters and ordering use provider-neutral public fields', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-30T12:00:00.000Z'));
  try {
    const story = await new InvocationStory().ready();
    const seen: string[] = [];
    story.manager.subscribe(
      { agent: { id: 'alpha', version: '2.0.0' }, types: ['invocation.started'] },
      ({ invocationId }) => seen.push(invocationId),
    );

    await story.start('zeta-first', 'zeta');
    vi.advanceTimersByTime(1);
    await story.start('alpha-second', 'alpha');

    expect(story.manager.listInvocations().map(({ invocationId }) => invocationId)).toEqual([
      'zeta-first',
      'alpha-second',
    ]);
    expect(
      story.manager
        .listInvocations({ agent: { id: 'alpha', version: '2.0.0' }, statuses: ['running'] })
        .map(({ invocationId }) => invocationId),
    ).toEqual(['alpha-second']);
    expect(seen).toEqual(['alpha-second']);
  } finally {
    vi.useRealTimers();
  }
});

test('invocation ordering uses the invocation id when accepted timestamps are equal', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-30T12:00:00.000Z'));
  try {
    const story = await new InvocationStory().ready();
    await story.start('zeta-same-time', 'zeta');
    await story.start('alpha-same-time', 'alpha');

    expect(story.manager.listInvocations().map(({ invocationId }) => invocationId)).toEqual([
      'alpha-same-time',
      'zeta-same-time',
    ]);
  } finally {
    vi.useRealTimers();
  }
});

test('query and event filters reject accessors and caller-owned array extensions', async () => {
  const story = await new InvocationStory().ready();
  const accessorFilter = Object.defineProperty({}, 'statuses', {
    enumerable: true,
    get: () => ['running'],
  });
  const extendedStatuses = ['running'];
  Object.defineProperty(extendedStatuses, 'extra', { value: true });
  const accessorEventFilter = Object.defineProperty({}, 'invocationId', {
    enumerable: true,
    get: () => 'invocation',
  });
  const extendedEventTypes = ['invocation.started'];
  Object.defineProperty(extendedEventTypes, 'extra', { value: true });
  const sparseStatuses = ['running'];
  sparseStatuses.length = 2;
  const accessorStatuses = ['running'];
  Object.defineProperty(accessorStatuses, '0', {
    enumerable: true,
    get: () => 'running',
  });
  const reorderedStatuses = new Array<string>(2);
  Object.defineProperty(reorderedStatuses, '0', { value: 'running' });
  Object.defineProperty(reorderedStatuses, 'extra', { value: true });
  const nonStandardStatuses = ['running'];
  Object.setPrototypeOf(nonStandardStatuses, null);
  const malformedAgent = { id: 'alpha' };
  const accessorAgent = Object.defineProperty({ version: '2.0.0' }, 'id', {
    enumerable: true,
    get: () => 'alpha',
  });

  await expectManagerFault(
    () => listInvocationsUnchecked(story.manager, accessorFilter),
    'revo.agent.internal',
  );
  await expectManagerFault(
    () => listInvocationsUnchecked(story.manager, { statuses: extendedStatuses }),
    'revo.agent.internal',
  );
  await expectManagerFault(
    () => subscribeUnchecked(story.manager, accessorEventFilter, () => {}),
    'revo.agent.internal',
  );
  await expectManagerFault(
    () => subscribeUnchecked(story.manager, { types: extendedEventTypes }, () => {}),
    'revo.agent.internal',
  );
  await Promise.all(
    [
      null,
      [],
      { unsupported: true },
      { invocationId: 42 },
      { agent: malformedAgent },
      { agent: accessorAgent },
      { agent: [] },
      { statuses: 'running' },
      { statuses: sparseStatuses },
      { statuses: accessorStatuses },
      { statuses: reorderedStatuses },
      { statuses: nonStandardStatuses },
    ].map((filter) =>
      expectManagerFault(
        () => listInvocationsUnchecked(story.manager, filter),
        'revo.agent.internal',
      ),
    ),
  );
});

test('terminal execution failures resolve through handles and manager waiters', async () => {
  const story = await new InvocationStory().ready();
  const handle = await story.start('failed-execution');
  const waiting = story.manager.waitForResult('failed-execution');

  story.fail('failed-execution');
  const result: AgentInvocationResult = await handle.result();

  expect(await waiting).toBe(result);
  expect(result.status).toBe('failed');
});
