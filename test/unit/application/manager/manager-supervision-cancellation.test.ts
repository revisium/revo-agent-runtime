import { expect, test } from 'vitest';

import { createAgentManager } from '../../../../src/application/manager/manager.js';
import type {
  ExecutionAdmission,
  InvocationExecutor,
} from '../../../../src/execution/invocation/executor.js';
import { captureRejection } from '../../../support/assertions/supervision.js';
import { agentDefinition } from '../../../support/builders/agent-definition.js';
import { acceptedAdmission } from '../../../support/builders/execution-evidence.js';
import { managerServices } from '../../../support/builders/manager-services.js';
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
test('late abort with uncertain drainage suppresses preacceptance callbacks and fails closed', async () => {
  let resolveAdmission!: (value: ExecutionAdmission) => void;
  let executionRequest!: Parameters<InvocationExecutor['start']>[0];
  let resolveExecutionStarted!: () => void;
  const admission = new Promise<ExecutionAdmission>((resolve) => {
    resolveAdmission = resolve;
  });
  const executionStarted = new Promise<void>((resolve) => {
    resolveExecutionStarted = resolve;
  });
  const executor: InvocationExecutor = {
    start: (received) => {
      executionRequest = received;
      resolveExecutionStarted();
      return {
        admission,
        completion: new Promise(() => undefined),
        drainage: Promise.resolve({ status: 'cleanup_uncertain' }),
        activate: received.onStarted,
        cancel: () => {
          received.onCancelling();
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
  const starting = manager.start(request('uncertain-late-abort'), { signal: controller.signal });

  await executionStarted;
  const rejection = captureRejection(starting);
  controller.abort();
  resolveAdmission(acceptedAdmission(executionRequest));

  expect(await rejection).toMatchObject({
    fault: { code: 'revo.agent.process_cleanup_failed', phase: 'execution' },
  });
  expect(executionRequest).toBeDefined();
  expect(events).toEqual([]);
  await expect(manager.shutdown()).rejects.toMatchObject({
    fault: { code: 'revo.agent.shutdown_failed' },
  });
});

test('cancel reports unknown after initialization and rejects before initialization', async () => {
  const executor: InvocationExecutor = {
    start: () => {
      throw new Error('No invocation expected.');
    },
  };
  const manager = managerFor(executor);

  await expect(manager.cancel('unknown-before-initialize')).rejects.toMatchObject({
    fault: { code: 'revo.agent.manager_not_initialized' },
  });
  await manager.initialize([]);
  await expect(manager.cancel('unknown-after-initialize')).resolves.toEqual({ state: 'unknown' });
  await manager.shutdown();
});

test('a confirmed preacceptance timeout preserves the running timeout fault', async () => {
  const executor: InvocationExecutor = {
    start: () => ({
      admission: Promise.resolve({
        cleanup: 'confirmed',
        outcome: { status: 'timed_out' },
        status: 'rejected',
      }),
      completion: Promise.resolve({ status: 'timed_out' }),
      drainage: Promise.resolve({ outcome: { status: 'timed_out' }, status: 'terminal' }),
      activate: () => undefined,
      cancel: () => false,
      evidence: () => undefined,
    }),
  };
  const manager = managerFor(executor);
  await manager.initialize([]);

  await expect(manager.start(request('timed-out-preacceptance'))).rejects.toMatchObject({
    fault: { code: 'revo.agent.timeout', phase: 'running' },
  });
  await manager.shutdown();
});
