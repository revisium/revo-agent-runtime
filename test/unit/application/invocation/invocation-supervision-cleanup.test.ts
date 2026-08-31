import { afterEach, expect, test, vi } from 'vitest';

import { createSealedAgentRegistry } from '../../../../src/definition/index.js';
import { createInvocationExecutor } from '../../../../src/execution/invocation/executor.js';
import { ProcessStartError, type ProcessSpawner } from '../../../../src/execution/process/port.js';
import type { ProtocolDriver } from '../../../../src/protocol/driver.js';
import { controlledSupervision, remainsPending } from '../../../support/assertions/supervision.js';
import { agentDefinition } from '../../../support/builders/agent-definition.js';
import { fixtureLaunchEvidence } from '../../../support/builders/execution-evidence.js';

afterEach(() => vi.useRealTimers());
test('a spawn failure with uncertain cleanup never publishes a terminal outcome', async () => {
  const processes: ProcessSpawner = {
    start: async () => {
      throw new ProcessStartError('uncertain');
    },
  };
  const protocol: ProtocolDriver = {
    open: async () => {
      throw new Error('Protocol must not open after failed process admission.');
    },
  };
  const definition = createSealedAgentRegistry([agentDefinition()]).list()[0]!.definition;
  const execution = createInvocationExecutor(processes, protocol).start({
    definition,
    idleTimeoutMs: 60_000,
    launch: fixtureLaunchEvidence,
    onCancelling: () => undefined,
    onStarted: () => undefined,
    parameters: {},
    permissions: {},
    prompt: 'Never delivered.',
    resultSchema: {},
    wallClockTimeoutMs: 60_000,
    workspace: '/fixture',
  });

  await expect(execution.admission).resolves.toMatchObject({
    cleanup: 'uncertain',
    status: 'rejected',
  });
  await expect(execution.drainage).resolves.toEqual({ status: 'cleanup_uncertain' });
  expect(await remainsPending(execution.completion)).toBe(true);
});

test('protocol open failure becomes a failed terminal and cleanup still completes', async () => {
  const scenario = controlledSupervision({ protocolOpen: 'reject' });
  await scenario.accept();

  await expect(scenario.execution.completion).resolves.toEqual({ status: 'failed' });
  expect(scenario.cleanupCalls()).toBe(1);
});

test('activation after cancellation skips protocol open and remains idempotent', async () => {
  const scenario = controlledSupervision();
  await scenario.admit();

  scenario.execution.cancel();
  scenario.activate();
  scenario.activate();

  await expect(scenario.execution.completion).resolves.toEqual({ status: 'cancelled' });
  expect(scenario.events).toEqual(['cancelling']);
});

test('a protocol session opened after cancellation is cancelled and closed safely', async () => {
  const scenario = controlledSupervision({
    protocolOpen: 'controlled',
    providerCancel: 'reject',
    providerClose: 'reject',
  });
  await scenario.accept();

  scenario.execution.cancel();
  scenario.protocolOpensLate();

  await expect.poll(scenario.providerCancelCalls).toBe(1);
  await expect.poll(scenario.providerCloseCalls).toBe(1);
  await expect(scenario.execution.completion).resolves.toEqual({ status: 'cancelled' });
});

test('a late protocol session without cancellation capability is still closed', async () => {
  const scenario = controlledSupervision({
    cancellation: false,
    protocolOpen: 'controlled',
    providerClose: 'reject',
  });
  await scenario.accept();

  scenario.execution.cancel();
  scenario.protocolOpensLate();

  await expect.poll(scenario.providerCloseCalls).toBe(1);
  expect(scenario.providerCancelCalls()).toBe(0);
  await expect(scenario.execution.completion).resolves.toEqual({ status: 'cancelled' });
});

test('a late protocol-open failure does not disturb completed local cancellation', async () => {
  const scenario = controlledSupervision({ protocolOpen: 'controlled' });
  await scenario.accept();

  scenario.execution.cancel();
  scenario.protocolFailsLate();

  await expect(scenario.execution.completion).resolves.toEqual({ status: 'cancelled' });
  expect(scenario.providerCloseCalls()).toBe(0);
});

test('pending spawn cancellation rejects admission only after the spawn attempt is quiescent', async () => {
  const processes: ProcessSpawner = {
    start: async (_launch, signal) =>
      new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new ProcessStartError('confirmed')), {
          once: true,
        });
      }),
  };
  const protocol: ProtocolDriver = {
    open: async () => {
      throw new Error('Protocol must not open before process admission.');
    },
  };
  const definition = createSealedAgentRegistry([agentDefinition()]).list()[0]!.definition;
  const execution = createInvocationExecutor(processes, protocol).start({
    definition,
    idleTimeoutMs: 60_000,
    launch: fixtureLaunchEvidence,
    onCancelling: () => {
      throw new Error('Preacceptance cancellation must not publish an event.');
    },
    onStarted: () => {
      throw new Error('Pending process must not start publicly.');
    },
    parameters: {},
    permissions: {},
    prompt: 'Never delivered.',
    resultSchema: {},
    wallClockTimeoutMs: 60_000,
    workspace: '/fixture',
  });

  execution.cancel();

  await expect(execution.admission).resolves.toEqual({
    cleanup: 'confirmed',
    outcome: { status: 'cancelled' },
    status: 'rejected',
  });
  await expect(execution.drainage).resolves.toMatchObject({ status: 'terminal' });
});
