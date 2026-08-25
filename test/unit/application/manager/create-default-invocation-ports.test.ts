import { expect, test } from 'vitest';

import { createDefaultInvocationPorts } from '../../../../src/application/manager/index.js';

test.each([
  {},
  { activeStateOperationTimeoutMs: 100, maxEventBytes: 1_024, maxEventsFileBytes: 2_048 },
])('creates frozen default ports for limits %j', (limits) => {
  const ports = createDefaultInvocationPorts(limits);
  expect(Object.isFrozen(ports)).toBe(true);
  expect(Object.keys(ports)).toEqual([
    'execution',
    'executableProbe',
    'clock',
    'workspace',
    'outputClaim',
    'outputPreparation',
    'output',
  ]);
  expect(typeof ports.execution.spawnAndIdentify).toBe('function');
  expect(typeof ports.executableProbe.hostPlatform).toBe('function');
  expect(['darwin', 'linux', 'win32', 'other']).toContain(ports.executableProbe.hostPlatform());
  expect(typeof ports.clock.now).toBe('function');
  expect(typeof ports.clock.schedule).toBe('function');
  expect(typeof ports.workspace.admit).toBe('function');
  expect(typeof ports.outputClaim.createExclusiveOutputDirectory).toBe('function');
  expect(typeof ports.outputPreparation.prepareClaimedOutput).toBe('function');
  expect(typeof ports.output.admit).toBe('function');
});
