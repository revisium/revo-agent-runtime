import { expect, test } from 'vitest';

import { invocationLimits } from '../../../../src/application/manager/limits.js';
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

const startUnchecked = (
  manager: ReturnType<typeof createAgentManager>,
  request: unknown,
): unknown =>
  Reflect.apply(
    (checkedRequest: StartAgentInvocation) => manager.start(checkedRequest),
    undefined,
    [request],
  );
test('normalizes a rejected protocol-port call into a failed terminal result', async () => {
  const manager = managerFor(executorFor({ status: 'failed' }));
  await manager.initialize([]);

  const result = await (
    await manager.start({
      agent: { id: 'codex', version: '1.0.0' },
      invocationId: 'rejected-driver',
      output: { directory: process.cwd() },
      parameters: {},
      permissions: {},
      prompt: 'Return a result.',
      result: { schema: { type: 'object' } },
      workspace: { directory: process.cwd() },
    })
  ).result();

  await manager.shutdown();
  expect(result).toMatchObject({ error: { code: 'revo.agent.protocol_failed' }, status: 'failed' });
});

test('owns a deeply frozen snapshot instead of returning a mutable driver value', async () => {
  const driverValue = { nested: { state: 'original' } };
  const requestMetadata = { nested: { state: 'original metadata' } };
  const manager = managerFor(executorFor({ status: 'succeeded', value: driverValue }));
  await manager.initialize([]);

  const result = await (
    await manager.start({
      agent: { id: 'codex', version: '1.0.0' },
      invocationId: 'owned-driver-value',
      metadata: requestMetadata,
      output: { directory: process.cwd() },
      parameters: {},
      permissions: {},
      prompt: 'Return a result.',
      result: { schema: { type: 'object' } },
      workspace: { directory: process.cwd() },
    })
  ).result();
  driverValue.nested.state = 'mutated after completion';
  requestMetadata.nested.state = 'mutated after completion';

  await manager.shutdown();
  if (result.status !== 'succeeded') throw new Error('Expected a successful driver result.');
  const metadata = result.metadata;
  if (metadata === undefined) throw new Error('Expected invocation metadata.');
  expect(result.value).toEqual({ nested: { state: 'original' } });
  expect(metadata).toEqual({ nested: { state: 'original metadata' } });
  expect(Object.isFrozen(result.value)).toBe(true);
  expect(Object.isFrozen(result.value.nested)).toBe(true);
  expect(Object.isFrozen(metadata)).toBe(true);
  expect(Object.isFrozen(metadata.nested)).toBe(true);
  expect(() => Object.assign(result.value, { changed: true })).toThrow();
  expect(() => Object.assign(metadata, { changed: true })).toThrow();
});

test('normalizes an uncloneable driver result into a failed terminal result', async () => {
  const manager = managerFor(
    executorFor({ status: 'succeeded', value: { callback: () => undefined } }),
  );
  await manager.initialize([]);

  const result = await (
    await manager.start({
      agent: { id: 'codex', version: '1.0.0' },
      invocationId: 'uncloneable-driver-value',
      output: { directory: process.cwd() },
      parameters: {},
      permissions: {},
      prompt: 'Return a result.',
      result: { schema: { type: 'object' } },
      workspace: { directory: process.cwd() },
    })
  ).result();

  await manager.shutdown();
  expect(result).toMatchObject({ error: { code: 'revo.agent.protocol_failed' }, status: 'failed' });
});

test('normalizes a driver result with mutable non-data values into a failed terminal result', async () => {
  const manager = managerFor(
    executorFor({ status: 'succeeded', value: { timestamp: new Date() } }),
  );
  await manager.initialize([]);

  const result = await (
    await manager.start({
      agent: { id: 'codex', version: '1.0.0' },
      invocationId: 'non-data-driver-value',
      output: { directory: process.cwd() },
      parameters: {},
      permissions: {},
      prompt: 'Return a result.',
      result: { schema: { type: 'object' } },
      workspace: { directory: process.cwd() },
    })
  ).result();

  await manager.shutdown();
  expect(result).toMatchObject({ error: { code: 'revo.agent.protocol_failed' }, status: 'failed' });
});

test('applies every execution-output default and rejects manager-only invocation limits', () => {
  expect(
    invocationLimits(undefined, { idleTimeoutMs: 1_000, wallClockTimeoutMs: 2_000 }),
  ).toMatchObject({
    maxCompletedInvocations: 1_000,
    maxEventBytes: 65_536,
    maxEventsFileBytes: 16_777_216,
    maxRawResponseBytes: 1_048_576,
    maxStderrBytes: 8_388_608,
    maxStdoutBytes: 8_388_608,
  });
  expect(() =>
    invocationLimits(
      { maxCompletedInvocations: 1 },
      { idleTimeoutMs: 1_000, wallClockTimeoutMs: 2_000 },
    ),
  ).toThrow('Agent invocation limit is invalid.');
});

test.each([
  1,
  { ...requestFor('unknown-key'), unexpected: true },
  { ...requestFor('missing-agent'), agent: null },
  { ...requestFor('limits-not-object'), limits: 1 },
  { ...requestFor('bad-limits'), limits: { idleTimeoutMs: '1000' } },
])('contains malformed public start input %#', async (request) => {
  const manager = managerFor(executorFor({ status: 'succeeded', value: {} }));
  await manager.initialize([]);

  await expect(startUnchecked(manager, request)).rejects.toMatchObject({
    fault: { code: 'revo.agent.definition_invalid', phase: 'preflight' },
  });
  await manager.shutdown();
});
