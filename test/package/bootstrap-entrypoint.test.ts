import { readFile } from 'node:fs/promises';

import { expect, test } from 'vitest';

import type {
  AgentDescriptor,
  AgentDefinition,
  AgentDefinitionInput,
  AgentDiscoveryResult,
  AgentInvocationFilter,
  AgentInvocationSnapshot,
  AgentInvocationStatus,
  AgentResultLookup,
} from '../../src/index.js';
import * as packageEntry from '../../src/index.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

test('manager iteration root exposes only the planned public runtime functions', () => {
  expect(Object.keys(packageEntry)).toEqual([
    'AgentManagerError',
    'createAgentManager',
    'discoverAgents',
  ]);
});

test('root exposes definition and discovery contracts at this iteration', () => {
  const definition: AgentDefinition = {
    schemaVersion: 'agent-definition/v1',
    id: 'agent',
    version: '1',
    displayName: 'Agent',
    launch: {
      command: 'agent',
      args: [],
      versionProbe: { args: ['--version'], stream: 'stdout', timeoutMs: 1_000 },
    },
    protocol: { driver: 'acp/v1', permissionStrategy: 'acp/v1' },
    delivery: { prompt: 'protocol', resultSchema: 'protocol', result: 'protocol' },
    parameters: { schema: {} },
    permissions: { schema: {} },
    capabilities: { cancellation: true, structuredResult: true, usage: false },
  };
  const input: AgentDefinitionInput = definition;
  const discovery: AgentDiscoveryResult = {
    definitions: [],
    diagnostics: [],
    modelObservations: [],
  };

  expect(definition.id).toBe('agent');
  expect(input.protocol.driver).toBe('acp/v1');
  expect(discovery.definitions).toEqual([]);
});

test('root exposes the v1 manager query contracts without another runtime export', () => {
  const status: AgentInvocationStatus = 'running';
  const filter: AgentInvocationFilter = {
    agent: { id: 'agent', version: '1' },
    statuses: [status],
  };
  const descriptor: AgentDescriptor = {
    agent: { id: 'agent', version: '1' },
    capabilities: { cancellation: true, structuredResult: true, usage: false },
    definitionDigest: 'digest',
    displayName: 'Agent',
  };
  const snapshot: AgentInvocationSnapshot = {
    acceptedAt: '2026-08-30T00:00:00.000Z',
    invocationId: 'invocation',
    outputDirectory: '/output',
    pin: { agentId: 'agent', agentVersion: '1', definitionDigest: 'digest' },
    status,
  };
  const lookup: AgentResultLookup = { invocation: snapshot, state: 'running' };

  expect(filter.agent).toEqual(descriptor.agent);
  expect(lookup).toEqual({ invocation: snapshot, state: 'running' });
});

test('package metadata declares only the root ESM entrypoint', async () => {
  const rawPackageJson: unknown = JSON.parse(
    await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
  );

  if (!isRecord(rawPackageJson) || !isRecord(rawPackageJson.exports)) {
    throw new TypeError('Expected package.json to declare an export map');
  }

  expect(rawPackageJson.exports).toEqual({
    '.': {
      types: './dist/index.d.ts',
      import: './dist/index.js',
    },
  });
});
