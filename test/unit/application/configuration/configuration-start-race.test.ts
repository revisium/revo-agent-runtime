import { expect, test } from 'vitest';

import { normalizeAcpConfiguration } from '../../../../src/configuration/catalog.js';
import { validateAgentDefinition } from '../../../../src/definition/index.js';
import { createConfigurationInspector } from '../../../../src/execution/configuration/inspector.js';
import type {
  OwnedProcess,
  ProcessCleanupOutcome,
  ProcessSpawner,
} from '../../../../src/execution/process/port.js';
import type { ProtocolConfigurationDriver } from '../../../../src/protocol/configuration-driver.js';
import { agentDefinition } from '../../../support/builders/agent-definition.js';
import { processIdentity } from '../../../support/builders/process-identity.js';

const never = <T>(): Promise<T> => new Promise(() => undefined);

test('starts protocol opening before cancellation queued after process start', async () => {
  const controller = new AbortController();
  const events: string[] = [];
  let resolveStart!: (process: OwnedProcess) => void;
  const start = new Promise<OwnedProcess>((resolve) => {
    resolveStart = resolve;
  });
  const session = {
    catalog: normalizeAcpConfiguration([
      {
        currentValue: 'fixture-model',
        id: 'model',
        name: 'Model',
        options: [{ name: 'Fixture model', value: 'fixture-model' }],
        type: 'select' as const,
      },
    ]),
    close: async () => {
      events.push('closed');
    },
  };
  const process: OwnedProcess = {
    completion: never(),
    identity: processIdentity(),
    terminateAndReap: async () => ({
      exit: { exitCode: 0, signal: null },
      status: 'confirmed' as const,
    }),
    transport: {
      input: new WritableStream<Uint8Array>(),
      output: new ReadableStream<Uint8Array>(),
    },
  };
  const processes: ProcessSpawner = { start: () => start };
  const protocol: ProtocolConfigurationDriver = {
    inspect: () => {
      events.push('opened');
      return Promise.resolve(session);
    },
  };
  const inspector = createConfigurationInspector(processes, protocol, () => undefined);
  const outcomePromise = inspector.inspect({
    definition: validateAgentDefinition(agentDefinition()).definition,
    environment: {},
    idleTimeoutMs: 1_000,
    launch: { executable: '/fixture/agent', reportedVersion: '1.0.0' },
    maxOutputBytes: 1_024,
    redactionSecrets: [],
    signal: controller.signal,
    wallClockTimeoutMs: 1_000,
    workspace: '/fixture/workspace',
  });

  queueMicrotask(() => {
    resolveStart(process);
    const enqueueCancellation = (remaining: number): void => {
      if (remaining === 0) {
        controller.abort();
        return;
      }
      queueMicrotask(() => enqueueCancellation(remaining - 1));
    };
    enqueueCancellation(5);
  });

  const outcome = await outcomePromise;

  expect(events).toEqual(['opened', 'closed']);
  expect(outcome).toMatchObject({ status: 'completed' });
});

test('finishes the deadline before a post-reap cancellation microtask', async () => {
  const controller = new AbortController();
  let processSignal: AbortSignal | undefined;
  let resolveCleanup!: (outcome: ProcessCleanupOutcome) => void;
  let resolveCleanupStarted!: () => void;
  const cleanup = new Promise<ProcessCleanupOutcome>((resolve) => {
    resolveCleanup = resolve;
  });
  const cleanupStarted = new Promise<void>((resolve) => {
    resolveCleanupStarted = resolve;
  });
  const process: OwnedProcess = {
    completion: never(),
    identity: processIdentity(),
    terminateAndReap: async () => {
      resolveCleanupStarted();
      return cleanup;
    },
    transport: {
      input: new WritableStream<Uint8Array>(),
      output: new ReadableStream<Uint8Array>(),
    },
  };
  const processes: ProcessSpawner = {
    start: async (_launch, signal) => {
      processSignal = signal;
      return process;
    },
  };
  const protocol: ProtocolConfigurationDriver = {
    inspect: async () => {
      throw new Error('fixture opening failure');
    },
  };
  const inspector = createConfigurationInspector(processes, protocol, () => undefined);
  const outcomePromise = inspector.inspect({
    definition: validateAgentDefinition(agentDefinition()).definition,
    environment: {},
    idleTimeoutMs: 1_000,
    launch: { executable: '/fixture/agent', reportedVersion: '1.0.0' },
    maxOutputBytes: 1_024,
    redactionSecrets: [],
    signal: controller.signal,
    wallClockTimeoutMs: 1_000,
    workspace: '/fixture/workspace',
  });

  await cleanupStarted;
  resolveCleanup({ exit: { exitCode: 0, signal: null }, status: 'confirmed' });
  queueMicrotask(() =>
    queueMicrotask(() => queueMicrotask(() => queueMicrotask(() => controller.abort()))),
  );

  await expect(outcomePromise).resolves.toMatchObject({ status: 'failed' });
  expect(controller.signal.aborted).toBe(true);
  expect(processSignal?.aborted).toBe(false);
});
