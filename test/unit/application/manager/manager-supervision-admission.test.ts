import { expect, test } from 'vitest';

import { createAgentManager } from '../../../../src/application/manager/manager.js';
import type {
  ExecutionAdmission,
  ExecutionDrainage,
  InvocationExecutor,
} from '../../../../src/execution/invocation/executor.js';
import { captureRejection, remainsPending } from '../../../support/assertions/supervision.js';
import { agentDefinition } from '../../../support/builders/agent-definition.js';
import { acceptedAdmission } from '../../../support/builders/execution-evidence.js';
import { managerServices } from '../../../support/builders/manager-services.js';
import { activeExecutionStory } from '../../../support/stories/active-state-execution.js';
import { noOpActiveStateSink } from '../../../support/stories/active-state.js';

const request = (invocationId: string) => ({
  agent: { id: 'codex', version: '1.0.0' },
  invocationId,
  output: { directory: '/fixture/output' },
  parameters: {},
  permissions: {},
  prompt: 'Wait.',
  result: { schema: { type: 'object' } },
  workspace: { directory: '/fixture/workspace' },
});

const options = {
  activeStateSink: noOpActiveStateSink,
  definitions: [agentDefinition()],
};

const managerFor = (executor: InvocationExecutor) =>
  createAgentManager(options, managerServices({ executor }));
test('shutdown fails closed and withholds finished when cleanup cannot be confirmed', async () => {
  let cancelling: (() => void) | undefined;
  const executor: InvocationExecutor = {
    start: (executionRequest) => {
      cancelling = executionRequest.onCancelling;
      return {
        admission: Promise.resolve(acceptedAdmission(executionRequest)),
        completion: new Promise(() => undefined),
        drainage: Promise.resolve({ status: 'cleanup_uncertain' }),
        activate: executionRequest.onStarted,
        cancel: () => {
          cancelling?.();
          return true;
        },
        evidence: () => undefined,
      };
    },
  };
  const manager = managerFor(executor);
  const events: string[] = [];
  await manager.initialize([]);
  manager.subscribe({}, ({ type }) => events.push(type));
  const handle = await manager.start(request('uncertain-cleanup'));

  await expect(manager.shutdown()).rejects.toMatchObject({
    fault: { code: 'revo.agent.shutdown_failed', phase: 'shutdown' },
  });

  expect(await remainsPending(handle.result())).toBe(true);
  expect(events).toEqual(['invocation.accepted', 'invocation.started', 'invocation.cancelling']);
});

test('a duplicate id is rejected while the first process spawn remains pending', async () => {
  let resolveAdmission!: (value: ExecutionAdmission) => void;
  let resolveDrainage!: (value: ExecutionDrainage) => void;
  const admission = new Promise<ExecutionAdmission>((resolve) => {
    resolveAdmission = resolve;
  });
  const drainage = new Promise<ExecutionDrainage>((resolve) => {
    resolveDrainage = resolve;
  });
  const executor: InvocationExecutor = {
    start: () => ({
      admission,
      completion: new Promise(() => undefined),
      drainage,
      activate: () => undefined,
      cancel: () => {
        resolveAdmission({
          cleanup: 'confirmed',
          outcome: { status: 'cancelled' },
          status: 'rejected',
        });
        resolveDrainage({ outcome: { status: 'cancelled' }, status: 'terminal' });
        return true;
      },
      evidence: () => undefined,
    }),
  };
  const manager = managerFor(executor);
  await manager.initialize([]);
  const firstStart = manager.start(request('reserved-id'));

  await expect(manager.start(request('reserved-id'))).rejects.toMatchObject({
    fault: { code: 'revo.agent.invocation_duplicate', phase: 'preflight' },
  });
  const shutdown = manager.shutdown();
  await expect(firstStart).rejects.toMatchObject({ fault: { code: 'revo.agent.cancelled' } });
  await shutdown;
});

test('an already-aborted start is cleaned up without public acceptance', async () => {
  const executor: InvocationExecutor = {
    start: () => {
      let resolveAdmission!: (value: ExecutionAdmission) => void;
      let resolveDrainage!: (value: ExecutionDrainage) => void;
      const admission = new Promise<ExecutionAdmission>((resolve) => {
        resolveAdmission = resolve;
      });
      const drainage = new Promise<ExecutionDrainage>((resolve) => {
        resolveDrainage = resolve;
      });
      return {
        admission,
        completion: new Promise(() => undefined),
        drainage,
        activate: () => undefined,
        cancel: () => {
          resolveAdmission({
            cleanup: 'confirmed',
            outcome: { status: 'cancelled' },
            status: 'rejected',
          });
          resolveDrainage({ outcome: { status: 'cancelled' }, status: 'terminal' });
          return true;
        },
        evidence: () => undefined,
      };
    },
  };
  const manager = managerFor(executor);
  const events: string[] = [];
  await manager.initialize([]);
  manager.subscribe({}, ({ type }) => events.push(type));
  const controller = new AbortController();
  controller.abort();

  await expect(
    manager.start(request('aborted-before-acceptance'), { signal: controller.signal }),
  ).rejects.toMatchObject({ fault: { code: 'revo.agent.cancelled', phase: 'running' } });

  await manager.shutdown();
  expect(events).toEqual([]);
});

test('an abort during admission drains the owned process before rejecting without events', async () => {
  const execution = activeExecutionStory('controlled');
  const manager = managerFor(execution.executor);
  const events: string[] = [];
  await manager.initialize([]);
  manager.subscribe({}, ({ type }) => events.push(type));
  const controller = new AbortController();
  const starting = manager.start(request('aborted-during-admission'), {
    signal: controller.signal,
  });
  await execution.waitUntilExecutionStarted();
  const rejection = captureRejection(starting);

  controller.abort();
  await execution.acceptProcess();

  expect(await rejection).toMatchObject({
    fault: { code: 'revo.agent.cancelled', phase: 'running' },
  });
  await manager.shutdown();
  expect(events).toEqual([]);
});

test('preacceptance cleanup uncertainty is retained and reported as a cleanup fault', async () => {
  const executor: InvocationExecutor = {
    start: () => ({
      admission: Promise.resolve({
        cleanup: 'uncertain',
        outcome: { status: 'failed' },
        status: 'rejected',
      }),
      completion: new Promise(() => undefined),
      drainage: Promise.resolve({ status: 'cleanup_uncertain' }),
      activate: () => undefined,
      cancel: () => false,
      evidence: () => undefined,
    }),
  };
  const manager = managerFor(executor);
  await manager.initialize([]);

  await expect(manager.start(request('uncertain-preacceptance'))).rejects.toMatchObject({
    fault: { code: 'revo.agent.process_cleanup_failed', phase: 'execution' },
  });
  await expect(manager.shutdown()).rejects.toMatchObject({
    fault: { code: 'revo.agent.shutdown_failed', phase: 'shutdown' },
  });
});
