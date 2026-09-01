import { expect, test } from 'vitest';

import { normalizeAcpConfiguration } from '../../../../src/configuration/catalog.js';
import { validateAgentDefinition } from '../../../../src/definition/index.js';
import {
  createConfigurationInspector,
  type ConfigurationInspectionRequest,
} from '../../../../src/execution/configuration/inspector.js';
import type {
  OwnedProcess,
  ProcessCleanupOutcome,
  ProcessSpawner,
} from '../../../../src/execution/process/port.js';
import type { ProtocolConfigurationDriver } from '../../../../src/protocol/configuration-driver.js';
import { agentDefinition } from '../../../support/builders/agent-definition.js';
import { processIdentity } from '../../../support/builders/process-identity.js';
import { configurationInspectionStory } from '../../../support/stories/configuration-inspection.js';

const never = <T>(): Promise<T> => new Promise(() => undefined);

test.each([
  [
    'an unsupported dynamic launch',
    configurationInspectionStory().useUnsupportedLaunch(),
    'failed',
  ],
  [
    'an uncertain primary start',
    configurationInspectionStory().primaryStartFails('uncertain-start'),
    'cleanup_uncertain',
  ],
  [
    'a confirmed primary start failure',
    configurationInspectionStory().primaryStartFails('confirmed-start'),
    'failed',
  ],
  [
    'an ordinary primary start failure',
    configurationInspectionStory().primaryStartFails('error'),
    'failed',
  ],
  ['protocol rejection', configurationInspectionStory().protocolRejects(), 'failed'],
  [
    'process exit before protocol opens',
    configurationInspectionStory().protocolExitsBeforeOpening(),
    'failed',
  ],
  [
    'uncertain cleanup before protocol opens',
    configurationInspectionStory().protocolRejects().primaryCleanupIsUncertain(),
    'cleanup_uncertain',
  ],
  ['protocol close rejection', configurationInspectionStory().protocolCloseFails(), 'failed'],
  ['protocol close timeout', configurationInspectionStory().protocolCloseHangs(), 'timed_out'],
  [
    'uncertain cleanup after protocol opens',
    configurationInspectionStory().primaryCleanupIsUncertain(),
    'cleanup_uncertain',
  ],
  [
    'an uncertain fallback start',
    configurationInspectionStory().useFallback().fallbackStartFails('uncertain-start'),
    'cleanup_uncertain',
  ],
  [
    'a confirmed fallback start failure',
    configurationInspectionStory().useFallback().fallbackStartFails('confirmed-start'),
    'failed',
  ],
  [
    'an ordinary fallback start failure',
    configurationInspectionStory().useFallback().fallbackStartFails('error'),
    'failed',
  ],
  [
    'uncertain fallback cleanup',
    configurationInspectionStory().useFallback().fallbackCleanupIsUncertain(),
    'cleanup_uncertain',
  ],
  ['fallback timeout', configurationInspectionStory().useFallback(), 'timed_out'],
  [
    'non-zero fallback exit',
    configurationInspectionStory().useFallback().fallbackExits({ exitCode: 1 }),
    'failed',
  ],
  [
    'signalled fallback exit',
    configurationInspectionStory().useFallback().fallbackExits({ signal: 'SIGTERM' }),
    'failed',
  ],
  [
    'truncated fallback output',
    configurationInspectionStory().useFallback().fallbackOutputIsTruncated().fallbackExits(),
    'failed',
  ],
  [
    'unparseable fallback output',
    configurationInspectionStory().useFallback().fallbackParseFails().fallbackExits(),
    'failed',
  ],
] as const)('fails safely for %s', async (_case, story, status) => {
  await expect(story.execute()).resolves.toMatchObject({ status });
});

test('publishes a parsed fallback catalog only after both processes are reaped', async () => {
  await expect(
    configurationInspectionStory().useFallback().fallbackExits().execute(),
  ).resolves.toMatchObject({ status: 'completed' });
});

test('reports cancellation and timeout while protocol opening remains pending', async () => {
  const cancelled = configurationInspectionStory().protocolHangs();
  cancelled.abort();
  await expect(cancelled.execute()).resolves.toMatchObject({ status: 'cancelled' });
  await expect(configurationInspectionStory().protocolHangs().execute()).resolves.toMatchObject({
    status: 'timed_out',
  });
});

test('starts closing an opened session before a queued cancellation microtask', async () => {
  const controller = new AbortController();
  const events: string[] = [];
  controller.signal.addEventListener('abort', () => events.push('aborted'), { once: true });
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
  const opening = Promise.resolve(session);
  const scheduleCancellationInAddedGap = (): void => {
    queueMicrotask(() => {
      void opening.then(() =>
        queueMicrotask(() => queueMicrotask(() => queueMicrotask(() => controller.abort()))),
      );
    });
  };
  const protocol: ProtocolConfigurationDriver = {
    inspect: () => {
      scheduleCancellationInAddedGap();
      return opening;
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
  const processes: ProcessSpawner = { start: async () => process };
  const inspector = createConfigurationInspector(processes, protocol, () => undefined);
  const request: ConfigurationInspectionRequest = {
    definition: validateAgentDefinition(agentDefinition()).definition,
    environment: {},
    idleTimeoutMs: 1_000,
    launch: { executable: '/fixture/agent', reportedVersion: '1.0.0' },
    maxOutputBytes: 1_024,
    redactionSecrets: [],
    signal: controller.signal,
    wallClockTimeoutMs: 1_000,
    workspace: '/fixture/workspace',
  };

  const outcome = await inspector.inspect(request);

  expect(events).toEqual(['closed', 'aborted']);
  expect(outcome).toMatchObject({ status: 'completed' });
});

test('keeps the deadline active until a failed opening process is reaped', async () => {
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
  controller.abort();
  expect(processSignal?.aborted).toBe(true);
  resolveCleanup({ exit: { exitCode: 0, signal: null }, status: 'confirmed' });

  await expect(outcomePromise).resolves.toMatchObject({ status: 'failed' });
});
