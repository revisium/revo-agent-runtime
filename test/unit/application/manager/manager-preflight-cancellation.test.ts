import { expect, test } from 'vitest';

import { createAgentManager } from '../../../../src/application/manager/manager.js';
import { agentDefinition } from '../../../support/builders/agent-definition.js';
import { managerOptions, managerServices } from '../../../support/builders/manager-services.js';
import { managerPreflightInvocation as invocation } from '../../../support/stories/manager-preflight.js';
test('does not claim or spawn when cancellation follows a ready executable proof', async () => {
  let resolveProbe!: () => void;
  let probeStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    probeStarted = resolve;
  });
  const mayResolve = new Promise<void>((resolve) => {
    resolveProbe = resolve;
  });
  let claimed = 0;
  let spawned = 0;
  const services = managerServices({
    executor: {
      start: () => {
        spawned += 1;
        throw new Error('Cancellation must stop after proof.');
      },
    },
    executablePreflight: {
      probe: async () => {
        probeStarted();
        await mayResolve;
        return {
          launch: { executable: '/resolved/agent', reportedVersion: '2.0.0' },
          status: 'ready' as const,
        };
      },
    },
    outputClaimPlatform: {
      createExclusiveDirectory: async () => {
        claimed += 1;
        return 'created';
      },
      inspectDirectory: async () => 'directory',
    },
  });
  const manager = createAgentManager(managerOptions([agentDefinition()]), services);
  await manager.initialize([]);
  const cancellation = new AbortController();

  const starting = manager.start(invocation('cancel-after-executable-proof'), {
    signal: cancellation.signal,
  });
  await started;
  cancellation.abort();
  resolveProbe();

  await expect(starting).rejects.toMatchObject({
    fault: { code: 'revo.agent.cancelled', phase: 'running' },
  });
  await expect(manager.shutdown()).resolves.toBeUndefined();

  expect(claimed).toBe(0);
  expect(spawned).toBe(0);
});
