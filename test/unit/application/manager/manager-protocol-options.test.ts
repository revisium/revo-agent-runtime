import { expect, test } from 'vitest';

import { createAgentManager } from '../../../../src/application/manager/manager.js';
import type { StartAgentInvocation } from '../../../../src/contracts/manager.js';
import type {
  ExecutionOutcome,
  InvocationExecutor,
} from '../../../../src/execution/invocation/executor.js';
import { agentDefinition } from '../../../support/builders/agent-definition.js';
import {
  acceptedAdmission,
  fixtureExecutionEvidence,
  terminalDrainage,
} from '../../../support/builders/execution-evidence.js';
import { managerServices } from '../../../support/builders/manager-services.js';
import { noOpActiveStateSink } from '../../../support/stories/active-state.js';

const executorFor = (outcome: ExecutionOutcome): InvocationExecutor => ({
  start: (request) => ({
    admission: Promise.resolve(acceptedAdmission(request)),
    completion: Promise.resolve(outcome),
    drainage: Promise.resolve(terminalDrainage(request, outcome)),
    evidence: () => fixtureExecutionEvidence(request),
    output: () => ({ stderr: new Uint8Array(), stdout: new Uint8Array() }),
    activate: request.onStarted,
    cancel: () => false,
  }),
});

const requestFor = (invocationId: string): StartAgentInvocation => ({
  agent: { id: 'codex', version: '1.0.0' },
  invocationId,
  output: { directory: process.cwd() },
  parameters: {},
  permissions: {},
  prompt: 'Return a result.',
  result: { schema: { type: 'object' } },
  workspace: { directory: process.cwd() },
});

const managerFor = (
  executor: InvocationExecutor,
  limits?: { readonly maxCompletedInvocations?: number },
) =>
  createAgentManager(
    {
      activeStateSink: noOpActiveStateSink,
      definitions: [agentDefinition()],
      ...(limits === undefined ? {} : { limits }),
    },
    managerServices({ executor }),
  );

test('rejects an invalid result schema before execution admission', async () => {
  const manager = managerFor(executorFor({ status: 'succeeded', value: {} }));
  await manager.initialize([]);
  const request = requestFor('invalid-schema');
  request.result.schema.type = 'not-a-json-schema-type';

  await expect(manager.start(request)).rejects.toMatchObject({
    fault: { code: 'revo.agent.definition_invalid', phase: 'preflight' },
  });
  await manager.shutdown();
});

test('supports sparse invocation limit overrides and an executor without captured output', async () => {
  const executor: InvocationExecutor = {
    start: (request) => ({
      admission: Promise.resolve(acceptedAdmission(request)),
      completion: Promise.resolve({ status: 'succeeded', value: {} }),
      drainage: Promise.resolve(terminalDrainage(request, { status: 'succeeded', value: {} })),
      evidence: () => fixtureExecutionEvidence(request),
      activate: request.onStarted,
      cancel: () => false,
    }),
  };
  const manager = managerFor(executor);
  await manager.initialize([]);
  const request = { ...requestFor('sparse-limits'), limits: { idleTimeoutMs: 1_000 } };

  await expect((await manager.start(request)).result()).resolves.toMatchObject({
    status: 'succeeded',
  });
  await manager.shutdown();
});

test('snapshots every invocation output limit field', async () => {
  const manager = managerFor(executorFor({ status: 'succeeded', value: {} }));
  await manager.initialize([]);
  const request = {
    ...requestFor('all-limits'),
    limits: {
      idleTimeoutMs: 1_000,
      maxEventBytes: 1_024,
      maxEventsFileBytes: 3_000_000,
      maxRawResponseBytes: 65_536,
      maxStderrBytes: 65_536,
      maxStdoutBytes: 65_536,
      wallClockTimeoutMs: 2_000,
    },
  };

  await expect((await manager.start(request)).result()).resolves.toMatchObject({
    status: 'succeeded',
  });
  await manager.shutdown();
});

test('evicts the oldest completed invocation at the configured retention bound', async () => {
  const manager = managerFor(executorFor({ status: 'succeeded', value: {} }), {
    maxCompletedInvocations: 1,
  });
  await manager.initialize([]);

  await (await manager.start(requestFor('first-completed'))).result();
  await (await manager.start(requestFor('second-completed'))).result();

  await expect(manager.cancel('first-completed')).resolves.toEqual({ state: 'unknown' });
  await expect(manager.cancel('second-completed')).resolves.toMatchObject({
    state: 'already_completed',
  });
  await manager.shutdown();
});
