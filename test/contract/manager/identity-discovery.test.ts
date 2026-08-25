import { expect, test } from 'vitest';

import { AgentManagerError } from '../../../src/runtime/errors/index.js';
import { buildAgentDefinition } from '../../support/definition/build-agent-definition.js';
import { createProbeCapableManager } from '../../support/manager/create-probe-capable-manager.js';

const fixtureDescriptor = {
  agent: { id: 'fixture-agent', version: '1.0.0' },
  definitionDigest: 'c4e8d168f60336726752b4c138babe7cc10bd20c0811b5dc2b0f8a98f4801690',
  displayName: 'Fixture Agent',
  capabilities: { cancellation: true, structuredResult: true, usage: true },
};

const expectPortUnobserved = (port: {
  calls(): readonly unknown[];
  hostPlatformReadCount(): number;
}): void => {
  expect(port.calls()).toEqual([]);
  expect(port.hostPlatformReadCount()).toBe(0);
};

test('constructs, discovers exact agents, and never observes the port', () => {
  const { manager, port } = createProbeCapableManager([buildAgentDefinition()]);
  expect(manager.listAgents()).toEqual([fixtureDescriptor]);
  expect(manager.getAgent({ id: 'fixture-agent', version: '1.0.0' })).toEqual(fixtureDescriptor);
  expectPortUnobserved(port);
});

test('returns undefined for an absent exact agent without observing the port', () => {
  const { manager, port } = createProbeCapableManager([buildAgentDefinition()]);
  expect(manager.getAgent({ id: 'missing-agent', version: '1.0.0' })).toBeUndefined();
  expectPortUnobserved(port);
});

test('rejects invalid definitions synchronously without observing the port', () => {
  expect(() => createProbeCapableManager([buildAgentDefinition({ id: '' })])).toThrow(
    AgentManagerError,
  );
});

test('rejects duplicate exact definitions synchronously without observing the port', () => {
  const definition = buildAgentDefinition();
  expect(() => createProbeCapableManager([definition, definition])).toThrow(AgentManagerError);
});

test('serves registry reads before initialization', () => {
  const { manager, port } = createProbeCapableManager([buildAgentDefinition()]);
  expect(manager.listAgents()).toEqual([fixtureDescriptor]);
  expect(manager.getAgent({ id: 'fixture-agent', version: '1.0.0' })).toEqual(fixtureDescriptor);
  expectPortUnobserved(port);
});

test('serves registry reads after shutdown', async () => {
  const { manager, port } = createProbeCapableManager([buildAgentDefinition()]);
  await manager.shutdown();
  expect(manager.listAgents()).toEqual([fixtureDescriptor]);
  expect(manager.getAgent({ id: 'fixture-agent', version: '1.0.0' })).toEqual(fixtureDescriptor);
  expectPortUnobserved(port);
});
