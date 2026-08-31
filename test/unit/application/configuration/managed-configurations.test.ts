import { expect, test } from 'vitest';

import { createAgentManager } from '../../../../src/application/manager/manager.js';
import type { InspectAgentConfiguration } from '../../../../src/contracts/configuration.js';
import type {
  AgentConfigurationInspector,
  ConfigurationInspectionOutcome,
} from '../../../../src/execution/configuration/inspector.js';
import { agentDefinition } from '../../../support/builders/agent-definition.js';
import { managerOptions, managerServices } from '../../../support/builders/manager-services.js';

const request = (): InspectAgentConfiguration => ({
  agent: { id: 'codex', version: '1.0.0' },
  workspace: { directory: '/workspace' },
});

const inspectorFor = (outcome: ConfigurationInspectionOutcome): AgentConfigurationInspector => ({
  inspect: async () => outcome,
});

const managerFor = (inspector: AgentConfigurationInspector) =>
  createAgentManager(
    managerOptions([agentDefinition()]),
    managerServices({ configurationInspector: inspector }),
  );

const inspectInvalidRequest = (manager: ReturnType<typeof managerFor>, value: unknown) => {
  const inspect: unknown = Reflect.get(manager, 'inspectConfiguration');
  if (typeof inspect !== 'function') throw new TypeError('Expected configuration inspection.');
  const result: unknown = Reflect.apply(inspect, manager, [value]);
  if (!(result instanceof Promise)) throw new TypeError('Expected asynchronous inspection.');
  return result;
};

test.each([
  ['cancelled', 'revo.agent.cancelled'],
  ['timed_out', 'revo.agent.timeout'],
  ['cleanup_uncertain', 'revo.agent.process_cleanup_failed'],
  ['failed', 'revo.agent.protocol_failed'],
] as const)('maps %s configuration execution to a typed manager fault', async (status, code) => {
  const manager = managerFor(inspectorFor({ status }));
  await manager.initialize([]);

  await expect(manager.inspectConfiguration(request())).rejects.toMatchObject({ fault: { code } });

  await manager.shutdown();
});

test('validates the request, definition, environment, and executable before inspection', async () => {
  const manager = managerFor(
    inspectorFor({
      catalog: { catalogRevision: 'revision', options: [] },
      launch: { executable: '/agent', reportedVersion: '1.0.0' },
      status: 'completed',
    }),
  );
  await manager.initialize([]);

  await expect(inspectInvalidRequest(manager, { agent: null })).rejects.toMatchObject({
    fault: { code: 'revo.agent.definition_invalid' },
  });
  await expect(
    manager.inspectConfiguration({ ...request(), agent: { id: 'missing', version: '1.0.0' } }),
  ).rejects.toMatchObject({ fault: { code: 'revo.agent.agent_unknown' } });
  await expect(
    manager.inspectConfiguration(request(), {
      environment: { inherit: [], secrets: { TOKEN: '' }, variables: {} },
    }),
  ).rejects.toMatchObject({ fault: { code: 'revo.agent.definition_invalid' } });

  await manager.shutdown();
});

test.each([
  [{ probe: async () => ({ status: 'aborted' as const }) }, 'revo.agent.cancelled'],
  [
    { probe: async () => ({ reason: 'probe_timeout' as const, status: 'rejected' as const }) },
    'revo.agent.probe_timeout',
  ],
] as const)('maps executable preflight before opening a session', async (preflight, code) => {
  const manager = createAgentManager(
    managerOptions([agentDefinition()]),
    managerServices({ executablePreflight: preflight }),
  );
  await manager.initialize([]);

  await expect(manager.inspectConfiguration(request())).rejects.toMatchObject({ fault: { code } });

  await manager.shutdown();
});

test('does not publish an inspection that completes after shutdown starts', async () => {
  const inspected = Promise.withResolvers<ConfigurationInspectionOutcome>();
  const started = Promise.withResolvers<void>();
  const manager = managerFor({
    inspect: async () => {
      started.resolve();
      return inspected.promise;
    },
  });
  await manager.initialize([]);
  const result = manager.inspectConfiguration(request());
  await started.promise;
  const shutdown = manager.shutdown();
  inspected.resolve({
    catalog: { catalogRevision: 'revision', options: [] },
    launch: { executable: '/agent', reportedVersion: '1.0.0' },
    status: 'completed',
  });

  await expect(result).rejects.toMatchObject({ fault: { code: 'revo.agent.manager_closed' } });
  await expect(shutdown).resolves.toBeUndefined();
});

test('publishes a model-free catalog without inventing model metadata', async () => {
  const manager = managerFor(
    inspectorFor({
      catalog: { catalogRevision: 'revision', options: [] },
      launch: { executable: '/agent', reportedVersion: '1.0.0' },
      status: 'completed',
    }),
  );
  await manager.initialize([]);

  await expect(manager.inspectConfiguration(request())).resolves.not.toHaveProperty('model');

  await manager.shutdown();
});
