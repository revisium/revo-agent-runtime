import { expect, test } from 'vitest';

import { createM1AgentManager } from '../../../src/application/manager/index.js';
import { AgentManagerError } from '../../../src/runtime/errors/index.js';
import { buildAgentDefinition } from '../../support/definition/build-agent-definition.js';
import { FakeExecutableProbePort } from '../../support/probe/fake-executable-probe-port.js';

const fixtureDescriptor = {
  agent: { id: 'fixture-agent', version: '1.0.0' },
  definitionDigest: 'c4e8d168f60336726752b4c138babe7cc10bd20c0811b5dc2b0f8a98f4801690',
  displayName: 'Fixture Agent',
  capabilities: { cancellation: true, structuredResult: true, usage: true },
};

const expectPortUnobserved = (port: FakeExecutableProbePort): void => {
  expect(port.calls()).toEqual([]);
  expect(port.hostPlatformReadCount()).toBe(0);
};

test('constructs synchronously, discovers exact agents, and never observes the port', () => {
  const port = new FakeExecutableProbePort({ platform: 'linux' });
  const discovery = createM1AgentManager({ definitions: [buildAgentDefinition()] }, port);

  expect(discovery.listAgents()).toEqual([fixtureDescriptor]);
  expect(discovery.getAgent({ id: 'fixture-agent', version: '1.0.0' })).toEqual(fixtureDescriptor);
  expectPortUnobserved(port);
});

test('returns undefined for an absent exact agent without observing the port', () => {
  const port = new FakeExecutableProbePort({ platform: 'linux' });
  const discovery = createM1AgentManager({ definitions: [buildAgentDefinition()] }, port);

  expect(discovery.getAgent({ id: 'missing-agent', version: '1.0.0' })).toBeUndefined();
  expectPortUnobserved(port);
});

test('rejects invalid definitions synchronously without observing the port', () => {
  const port = new FakeExecutableProbePort({ platform: 'linux' });

  expect(() =>
    createM1AgentManager({ definitions: [buildAgentDefinition({ id: '' })] }, port),
  ).toThrow(AgentManagerError);
  expectPortUnobserved(port);
});

test('rejects duplicate exact definitions synchronously without observing the port', () => {
  const port = new FakeExecutableProbePort({ platform: 'linux' });
  const definition = buildAgentDefinition();

  expect(() => createM1AgentManager({ definitions: [definition, definition] }, port)).toThrow(
    AgentManagerError,
  );
  expectPortUnobserved(port);
});
