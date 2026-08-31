import { expect, test } from 'vitest';

import { createAgentManager } from '../../../../src/application/manager/manager.js';
import type { InvocationExecutor } from '../../../../src/execution/invocation/executor.js';
import { agentDefinition } from '../../../support/builders/agent-definition.js';
import {
  fixtureExecutionEvidence,
  terminalDrainage,
} from '../../../support/builders/execution-evidence.js';
import { managerOptions, managerServices } from '../../../support/builders/manager-services.js';
import { processIdentity } from '../../../support/builders/process-identity.js';
import { managerPreflightInvocation as invocation } from '../../../support/stories/manager-preflight.js';
test('proves the executable before claiming output and spawns only through that prepared launch', async () => {
  const calls: string[] = [];
  const executor: InvocationExecutor = {
    start: (request) => {
      calls.push(`spawn:${request.launch.executable}`);
      const outcome = { status: 'succeeded' as const, value: {} };
      return {
        admission: Promise.resolve({
          identity: processIdentity(),
          launch: request.launch,
          status: 'accepted' as const,
        }),
        completion: Promise.resolve(outcome),
        drainage: Promise.resolve(terminalDrainage(request, outcome)),
        activate: request.onStarted,
        cancel: () => false,
        evidence: () => fixtureExecutionEvidence(request),
      };
    },
  };
  const services = managerServices({
    executor,
    executablePreflight: {
      probe: async () => {
        calls.push('probe');
        return {
          launch: { executable: '/resolved/agent', reportedVersion: '2.0.0' },
          status: 'ready' as const,
        };
      },
    },
    outputClaimPlatform: {
      createExclusiveDirectory: async () => {
        calls.push('claim');
        return 'created' as const;
      },
      inspectDirectory: async () => {
        calls.push('prepare');
        return 'directory' as const;
      },
    },
  });
  const manager = createAgentManager(managerOptions([agentDefinition()]), services);
  await manager.initialize([]);

  await (await manager.start(invocation('ordered-preflight'))).result();
  await manager.shutdown();

  expect(calls).toEqual(['prepare', 'prepare', 'probe', 'claim', 'spawn:/resolved/agent']);
});

test.each([
  ['workspace invalid', 'workspace_invalid'],
  ['output path invalid', 'output_path_invalid'],
] as const)(
  'does not probe, claim, or spawn when output preparation is %s',
  async (_name, reason) => {
    let probes = 0;
    let spawns = 0;
    let inspections = 0;
    const services = managerServices({
      executor: {
        start: () => {
          spawns += 1;
          throw new Error('Must not spawn.');
        },
      },
      executablePreflight: {
        probe: async () => {
          probes += 1;
          return { status: 'aborted' };
        },
      },
      outputClaimPlatform: {
        createExclusiveDirectory: async () => 'created',
        inspectDirectory: async () => {
          inspections += 1;
          if (reason === 'workspace_invalid') return 'missing';
          return inspections === 1 ? 'directory' : 'missing';
        },
      },
    });
    const manager = createAgentManager(managerOptions([agentDefinition()]), services);
    await manager.initialize([]);

    await expect(manager.start(invocation(`prepared-${reason}`))).rejects.toMatchObject({
      fault: { code: `revo.agent.${reason}`, phase: 'preflight' },
    });
    await manager.shutdown();

    expect(probes).toBe(0);
    expect(spawns).toBe(0);
  },
);

test('does not claim or spawn when executable proof rejects', async () => {
  let claimed = 0;
  let spawned = 0;
  const services = managerServices({
    executor: {
      start: () => {
        spawned += 1;
        throw new Error('Must not spawn.');
      },
    },
    executablePreflight: {
      probe: async () => ({
        reason: 'probe_output_invalid' as const,
        status: 'rejected' as const,
      }),
    },
    outputClaimPlatform: {
      createExclusiveDirectory: async () => {
        claimed += 1;
        return 'created' as const;
      },
      inspectDirectory: async () => 'directory',
    },
  });
  const manager = createAgentManager(managerOptions([agentDefinition()]), services);
  await manager.initialize([]);

  await expect(manager.start(invocation('rejected-proof'))).rejects.toMatchObject({
    fault: { code: 'revo.agent.probe_output_invalid', phase: 'preflight' },
  });
  await manager.shutdown();

  expect(claimed).toBe(0);
  expect(spawned).toBe(0);
});

test('does not probe or spawn when output inspection cannot be confirmed', async () => {
  let probes = 0;
  let spawns = 0;
  const services = managerServices({
    executor: {
      start: () => {
        spawns += 1;
        throw new Error('Output inspection must reject before spawn.');
      },
    },
    executablePreflight: {
      probe: async () => {
        probes += 1;
        return { status: 'aborted' };
      },
    },
    outputClaimPlatform: {
      createExclusiveDirectory: async () => 'created',
      inspectDirectory: async () => 'uncertain',
    },
  });
  const manager = createAgentManager(managerOptions([agentDefinition()]), services);
  await manager.initialize([]);

  await expect(manager.start(invocation('uncertain-output-inspection'))).rejects.toMatchObject({
    fault: { code: 'revo.agent.output_path_invalid', phase: 'preflight' },
  });
  await expect(manager.shutdown()).resolves.toBeUndefined();

  expect(probes).toBe(0);
  expect(spawns).toBe(0);
});

test('does not claim or spawn when executable preflight is aborted', async () => {
  let claimed = 0;
  let spawned = 0;
  const services = managerServices({
    executor: {
      start: () => {
        spawned += 1;
        throw new Error('An aborted proof must not spawn.');
      },
    },
    executablePreflight: { probe: async () => ({ status: 'aborted' }) },
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

  await expect(manager.start(invocation('aborted-executable-proof'))).rejects.toMatchObject({
    fault: { code: 'revo.agent.cancelled', phase: 'running' },
  });
  await expect(manager.shutdown()).resolves.toBeUndefined();

  expect(claimed).toBe(0);
  expect(spawned).toBe(0);
});
