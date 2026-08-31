import { expect, test } from 'vitest';

import {
  AgentManagerError,
  createAgentManager,
  type AgentEventFilter,
  type AgentEventListener,
  type AgentManager,
} from '../../../../src/index.js';
import { withTemporaryDirectory } from '../../../support/assertions/temporary-directory.js';
import { agentDefinition } from '../../../support/builders/agent-definition.js';
import {
  publicAgentManager as managerWith,
  publicInvocationRequest as requestFor,
} from '../../../support/builders/public-agent-manager.js';
import { noOpActiveStateSink } from '../../../support/stories/active-state.js';

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

const subscribeUnchecked = (manager: AgentManager, filter: unknown, listener: unknown): unknown =>
  Reflect.apply(
    (checkedFilter: AgentEventFilter, checkedListener: AgentEventListener) =>
      manager.subscribe(checkedFilter, checkedListener),
    undefined,
    [filter, listener],
  );
test('contains invalid subscriptions and makes unsubscribe idempotent', async () => {
  await withTemporaryDirectory(async (directory) => {
    const manager = managerWith();
    await manager.initialize([]);

    expectFault(
      () => {
        subscribeUnchecked(manager, { unsupported: true }, () => undefined);
      },
      { code: 'revo.agent.internal', phase: 'manager' },
    );
    expectFault(
      () => {
        subscribeUnchecked(manager, {}, undefined);
      },
      { code: 'revo.agent.internal', phase: 'manager' },
    );
    expectFault(
      () => {
        subscribeUnchecked(
          manager,
          Object.create({}, { invocationId: { get: () => 'ignored' } }),
          () => undefined,
        );
      },
      { code: 'revo.agent.internal', phase: 'manager' },
    );

    const delivered: string[] = [];
    const unsubscribe = manager.subscribe({}, ({ type }) => delivered.push(type));
    await (await manager.start(requestFor(directory, 'after-invalid-subscribe'))).result();
    unsubscribe();
    unsubscribe();
    await (await manager.start(requestFor(directory, 'after-unsubscribe'))).result();

    await manager.shutdown();
    expect(delivered).toEqual(['invocation.accepted', 'invocation.started', 'invocation.finished']);
  });
});

test.each([
  {
    options: {
      activeStateSink: noOpActiveStateSink,
    },
    reason: 'missing definitions',
  },
  {
    options: {
      activeStateSink: noOpActiveStateSink,
      definitions: {},
    },
    reason: 'malformed definitions',
  },
  {
    options: {
      activeStateSink: noOpActiveStateSink,
      definitions: [agentDefinition({ id: '' })],
    },
    reason: 'invalid definition',
  },
  {
    options: {
      activeStateSink: noOpActiveStateSink,
      definitions: [agentDefinition(), agentDefinition()],
    },
    reason: 'duplicate definition',
  },
  {
    options: {
      activeStateSink: noOpActiveStateSink,
      definitions: [
        agentDefinition({ protocol: { driver: 'native/stdio-v1', permissionStrategy: 'acp/v1' } }),
      ],
    },
    reason: 'unsupported strategy',
  },
])('maps $reason at construction to a public fault', ({ options, reason }) => {
  expectFault(
    () => {
      Reflect.apply(createAgentManager, undefined, [options]);
    },
    {
      code:
        reason === 'duplicate definition'
          ? 'revo.agent.definition_duplicate'
          : reason === 'unsupported strategy'
            ? 'revo.agent.strategy_unsupported'
            : 'revo.agent.definition_invalid',
      phase: 'construction',
    },
  );
});

test('contains hostile construction and subscription input at the public boundary', async () => {
  const hostileOptions = new Proxy(
    {},
    {
      get: () => {
        throw new Error('options inspection failed');
      },
    },
  );
  expectFault(
    () => {
      Reflect.apply(createAgentManager, undefined, [hostileOptions]);
    },
    { code: 'revo.agent.definition_invalid', phase: 'construction' },
  );

  const manager = managerWith();
  await manager.initialize([]);
  const hostileFilter = new Proxy(
    {},
    {
      ownKeys: () => {
        throw new Error('filter inspection failed');
      },
    },
  );
  expectFault(
    () => {
      subscribeUnchecked(manager, hostileFilter, () => undefined);
    },
    { code: 'revo.agent.internal', phase: 'manager' },
  );
  await manager.shutdown();
});

test('isolates a throwing listener without changing the fake ACP result', async () => {
  await withTemporaryDirectory(async (directory) => {
    const manager = managerWith();
    await manager.initialize([]);
    manager.subscribe({}, () => {
      throw new Error('listener failed');
    });

    const result = await (await manager.start(requestFor(directory, 'listener-failure'))).result();

    await manager.shutdown();
    expect(result).toMatchObject({ status: 'succeeded', value: { answer: 'fake ACP result' } });
  });
});
