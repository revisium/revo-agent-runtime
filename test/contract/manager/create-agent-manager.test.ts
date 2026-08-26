import { expect, test } from 'vitest';

import { createAgentManager } from '../../../src/application/manager/index.js';
import { AgentManagerError } from '../../../src/runtime/errors/index.js';
import {
  createTestActiveStateSink,
  buildAgentDefinition,
} from '../../support/definition/build-agent-definition.js';

const definition = buildAgentDefinition();

const options = () => ({
  definitions: [definition],
  activeStateSink: createTestActiveStateSink(),
});

test('factory validates synchronously and projects the public manager', () => {
  expect(() =>
    createAgentManager({
      definitions: [],
      activeStateSink: createTestActiveStateSink(),
      limits: { maxCompletedInvocations: 0 },
    }),
  ).toThrow();
  const manager = createAgentManager(options());
  expect(manager.listAgents()).toHaveLength(1);
  expect(manager.getAgent({ id: definition.id, version: definition.version })).toBeDefined();
  expect(
    Reflect.ownKeys(manager).sort((left, right) => String(left).localeCompare(String(right))),
  ).toEqual([
    'cancel',
    'getAgent',
    'getInvocation',
    'getResult',
    'initialize',
    'listAgents',
    'listInvocations',
    'probeAgent',
    'shutdown',
    'start',
    'subscribe',
    'waitForResult',
  ]);
  expect(Object.isFrozen(manager)).toBe(true);
});

test('factory manager gates start and subscribe before initialization and after shutdown', async () => {
  const manager = createAgentManager(options());
  expect(() => manager.subscribe({}, () => undefined)).toThrowError(AgentManagerError);
  await manager.initialize([]);
  await manager.shutdown();
  expect(() => manager.subscribe({}, () => undefined)).toThrowError(AgentManagerError);
  expect(manager.getInvocation('missing')).toBeUndefined();
  await manager.shutdown();
});
