import { expect, test } from 'vitest';

import { createAgentManager } from '../../../../src/application/manager/manager.js';
import { agentDefinition } from '../../../support/builders/agent-definition.js';
import { terminalDrainage } from '../../../support/builders/execution-evidence.js';
import { managerOptions, managerServices } from '../../../support/builders/manager-services.js';
import { processIdentity } from '../../../support/builders/process-identity.js';
import { managerPreflightInvocation as invocation } from '../../../support/stories/manager-preflight.js';

test.each([
  ['exclusive output leaf already exists', 'conflict', 'revo.agent.output_conflict'],
  ['output inspection cannot be confirmed', 'uncertain', 'revo.agent.output_path_invalid'],
] as const)('does not spawn when %s', async (_description, creation, code) => {
  let spawned = 0;
  const services = managerServices({
    executor: {
      start: () => {
        spawned += 1;
        throw new Error('Output admission must reject before spawn.');
      },
    },
    outputClaimPlatform: {
      createExclusiveDirectory: async () => creation,
      inspectDirectory: async () => 'directory',
    },
  });
  const manager = createAgentManager(managerOptions([agentDefinition()]), services);
  await manager.initialize([]);

  await expect(manager.start(invocation(`output-${creation}`))).rejects.toMatchObject({
    fault: { code, phase: 'preflight' },
  });
  await expect(manager.shutdown()).resolves.toBeUndefined();

  expect(spawned).toBe(0);
});

test('maps a synchronous spawn failure after claiming output and leaves shutdown quiescent', async () => {
  let claims = 0;
  const services = managerServices({
    executor: {
      start: () => {
        throw new Error('The executor failed before admitting a process.');
      },
    },
    outputClaimPlatform: {
      createExclusiveDirectory: async () => {
        claims += 1;
        return 'created';
      },
      inspectDirectory: async () => 'directory',
    },
  });
  const manager = createAgentManager(managerOptions([agentDefinition()]), services);
  await manager.initialize([]);

  await expect(manager.start(invocation('synchronous-spawn-failure'))).rejects.toMatchObject({
    fault: { code: 'revo.agent.protocol_failed', phase: 'execution' },
  });
  await expect(manager.shutdown()).resolves.toBeUndefined();

  expect(claims).toBe(1);
});

test('does not accept cancellation observed after output claim and before spawn', async () => {
  let allowClaim!: () => void;
  let startedClaim!: () => void;
  const claimStarted = new Promise<void>((resolve) => {
    startedClaim = resolve;
  });
  const claimMayFinish = new Promise<void>((resolve) => {
    allowClaim = resolve;
  });
  let spawns = 0;
  const services = managerServices({
    executor: {
      start: () => {
        spawns += 1;
        throw new Error('Cancellation must stop before spawn.');
      },
    },
    outputClaimPlatform: {
      createExclusiveDirectory: async () => {
        startedClaim();
        await claimMayFinish;
        return 'created';
      },
      inspectDirectory: async () => 'directory',
    },
  });
  const manager = createAgentManager(managerOptions([agentDefinition()]), services);
  await manager.initialize([]);
  const cancellation = new AbortController();

  const starting = manager.start(invocation('cancel-after-claim'), { signal: cancellation.signal });
  await claimStarted;
  cancellation.abort();
  allowClaim();

  await expect(starting).rejects.toMatchObject({
    fault: { code: 'revo.agent.cancelled' },
  });
  await expect(manager.shutdown()).resolves.toBeUndefined();

  expect(spawns).toBe(0);
});

test('fails closed when terminal execution has no authentic cleanup evidence', async () => {
  const services = managerServices({
    executor: {
      start: (request) => {
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
          evidence: () => undefined,
        };
      },
    },
  });
  const manager = createAgentManager(managerOptions([agentDefinition()]), services);
  await manager.initialize([]);

  const handle = await manager.start(invocation('missing-terminal-evidence'));

  await expect(handle.result()).rejects.toMatchObject({
    fault: { code: 'revo.agent.process_cleanup_failed', phase: 'finalizing' },
  });
  await expect(manager.shutdown()).rejects.toMatchObject({
    fault: { code: 'revo.agent.shutdown_failed' },
  });
});

test('fails closed when claimed output cannot publish a terminal result', async () => {
  const services = managerServices({
    outputPublisher: {
      publish: async () => {
        throw new Error('Storage is unavailable.');
      },
    },
  });
  const manager = createAgentManager(managerOptions([agentDefinition()]), services);
  await manager.initialize([]);

  const handle = await manager.start(invocation('terminal-publication-failure'));

  await expect(handle.result()).rejects.toMatchObject({
    fault: { code: 'revo.agent.process_cleanup_failed', phase: 'finalizing' },
  });
  await expect(manager.shutdown()).rejects.toMatchObject({
    fault: { code: 'revo.agent.shutdown_failed' },
  });
});

test('settles uncertain preacceptance before shutdown rejects the unresolved reservation', async () => {
  const services = managerServices({
    executor: {
      start: () => ({
        admission: Promise.resolve({
          cleanup: 'uncertain' as const,
          outcome: { status: 'failed' as const },
          status: 'rejected' as const,
        }),
        completion: Promise.resolve({ status: 'failed' as const }),
        drainage: Promise.resolve({ status: 'cleanup_uncertain' as const }),
        activate: () => undefined,
        cancel: () => false,
        evidence: () => undefined,
      }),
    },
  });
  const manager = createAgentManager(managerOptions([agentDefinition()]), services);
  await manager.initialize([]);

  await expect(manager.start(invocation('uncertain-preacceptance'))).rejects.toMatchObject({
    fault: { code: 'revo.agent.process_cleanup_failed' },
  });
  await expect(manager.shutdown()).rejects.toMatchObject({
    fault: { code: 'revo.agent.shutdown_failed' },
  });
});
