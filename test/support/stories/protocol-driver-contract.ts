import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createAgentManager } from '../../../src/application/manager/manager.js';
import type {
  AgentInvocationResult,
  StartAgentInvocation,
} from '../../../src/contracts/manager.js';
import { createInvocationExecutor } from '../../../src/execution/invocation/executor.js';
import type {
  OwnedProcess,
  ProcessExit,
  ProcessSpawner,
} from '../../../src/execution/process/port.js';
import { nodeProcessSpawner } from '../../../src/platform/node/process/spawner.js';
import { acpProtocolDriver } from '../../../src/protocol/acp/driver.js';
import type { ProtocolDriver, ProtocolSessionRequest } from '../../../src/protocol/driver.js';
import { agentDefinition } from '../builders/agent-definition.js';
import { confirmedCleanup, fixtureProcessExit } from '../builders/execution-evidence.js';
import { definitionCommandPreflight, managerServices } from '../builders/manager-services.js';
import { processIdentity } from '../builders/process-identity.js';
import { fakeAcpDefinition } from '../fakes/fake-acp.js';
import {
  fakeNativeProtocolDriver,
  type NativeProtocolScenario,
} from '../fakes/fake-native-protocol-driver.js';
import { activeStateStory, type ActiveStateStory } from '../stories/active-state.js';

type ProtocolDriverContractScenario =
  | 'normal'
  | 'permission'
  | 'cancel'
  | 'malformed'
  | 'provider-failure'
  | 'missing-result'
  | 'empty-result'
  | 'duplicate-result'
  | 'schema-mismatch';

interface ProtocolDriverInput {
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly permissions: Readonly<Record<string, unknown>>;
  readonly prompt: string;
  readonly resultSchema: Readonly<Record<string, unknown>>;
  readonly workspace: string;
}

export interface ProtocolDriverContractRun {
  readonly activeState: ActiveStateStory;
  readonly events: () => readonly string[];
  readonly input: () => ProtocolDriverInput | undefined;
  readonly providerCancelCalls: () => Promise<number>;
  readonly providerCloseCalls: () => Promise<number>;
  readonly providerPermissionDecision?: () => Promise<
    | { readonly outcome: 'selected'; readonly optionId: string }
    | { readonly outcome: 'denied' }
    | undefined
  >;
  readonly processCleanupCalls: () => number;
  readonly wroteAfterClose?: () => boolean;
  cancel(): Promise<void>;
  dispose(): Promise<void>;
  lateProcessExit(): void;
  ready(): Promise<void>;
  result(): Promise<AgentInvocationResult>;
}

export interface ProtocolDriverContractSubject {
  readonly name: 'ACP' | 'fake native';
  start(
    directory: string,
    scenario: ProtocolDriverContractScenario,
    options?: { readonly resultSchema?: Readonly<Record<string, unknown>> },
  ): Promise<ProtocolDriverContractRun>;
}

interface CapturedAcpTrace {
  readonly cancelCalls: number;
  readonly closeCalls: number;
}

const contractRequest = (
  directory: string,
  scenario: ProtocolDriverContractScenario,
  resultSchema: Readonly<Record<string, unknown>>,
): StartAgentInvocation => ({
  agent: { id: 'codex', version: '1.0.0' },
  invocationId: `protocol-driver-${scenario}`,
  output: { directory },
  parameters: { format: 'structured', maxTurns: 1 },
  permissions: { filesystem: 'read-only' },
  prompt: 'Return the protocol contract result.',
  result: { schema: resultSchema },
  workspace: { directory },
});

const inputFrom = (request: ProtocolSessionRequest): ProtocolDriverInput =>
  Object.freeze({
    parameters: request.parameters,
    permissions: request.permissions,
    prompt: request.prompt,
    resultSchema: request.resultSchema,
    workspace: request.workspace,
  });

const captureProtocolDriver = (
  driver: ProtocolDriver,
  received: { value?: ProtocolDriverInput },
): ProtocolDriver =>
  Object.freeze({
    open: async (request: ProtocolSessionRequest) => {
      received.value = inputFrom(request);
      return driver.open(request);
    },
  });

const nativeScenarioFor = (scenario: ProtocolDriverContractScenario): NativeProtocolScenario => {
  if (scenario === 'normal') return 'completed';
  if (scenario === 'cancel') return 'waiting-for-cancellation';
  if (scenario === 'provider-failure') return 'open-failure';
  return scenario;
};

const acpModeFor = (scenario: ProtocolDriverContractScenario): string => {
  if (scenario === 'normal') return 'success';
  if (scenario === 'cancel') return 'hang';
  if (scenario === 'provider-failure') return 'eof';
  return scenario;
};

const traceAt = async (path: string): Promise<CapturedAcpTrace> => {
  const value: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (
    typeof value !== 'object' ||
    value === null ||
    !('cancelCalls' in value) ||
    !('closeCalls' in value) ||
    typeof value.cancelCalls !== 'number' ||
    typeof value.closeCalls !== 'number'
  )
    throw new TypeError('Invalid fake ACP contract trace.');
  return {
    cancelCalls: value.cancelCalls,
    closeCalls: value.closeCalls,
  };
};

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const waitUntil = async (
  condition: () => Promise<boolean> | boolean,
  attempts: number,
  failure: string,
): Promise<void> => {
  if (await condition()) return;
  if (attempts <= 1) throw new Error(failure);
  await delay(10);
  return waitUntil(condition, attempts - 1, failure);
};

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const waitForFile = (path: string): Promise<void> =>
  waitUntil(() => fileExists(path), 100, 'Fake ACP agent did not become ready within one second.');

const waitForInput = (input: () => ProtocolDriverInput | undefined): Promise<void> =>
  waitUntil(() => input() !== undefined, 100, 'Protocol driver did not open within one second.');

const contractRun = (
  manager: ReturnType<typeof createAgentManager>,
  activeState: ActiveStateStory,
  request: StartAgentInvocation,
  observations: {
    readonly input: () => ProtocolDriverInput | undefined;
    readonly providerCancelCalls: () => Promise<number>;
    readonly providerCloseCalls: () => Promise<number>;
    readonly providerPermissionDecision?: () => Promise<
      | { readonly outcome: 'selected'; readonly optionId: string }
      | { readonly outcome: 'denied' }
      | undefined
    >;
    readonly processCleanupCalls: () => number;
    readonly ready: () => Promise<void>;
    readonly wroteAfterClose?: () => boolean;
    readonly lateProcessExit: () => void;
  },
): Promise<ProtocolDriverContractRun> => {
  const events: string[] = [];
  manager.subscribe({}, ({ type }) => events.push(type));
  return manager.start(request).then((handle) =>
    Object.freeze({
      activeState,
      cancel: async () => {
        await handle.cancel('contract cancellation');
      },
      dispose: () => manager.shutdown(),
      events: () => [...events],
      input: observations.input,
      lateProcessExit: observations.lateProcessExit,
      processCleanupCalls: observations.processCleanupCalls,
      providerCancelCalls: observations.providerCancelCalls,
      providerCloseCalls: observations.providerCloseCalls,
      ...(observations.providerPermissionDecision === undefined
        ? {}
        : { providerPermissionDecision: observations.providerPermissionDecision }),
      ready: observations.ready,
      result: () => handle.result(),
      ...(observations.wroteAfterClose === undefined
        ? {}
        : { wroteAfterClose: observations.wroteAfterClose }),
    }),
  );
};

const fakeOwnedProcess = (): {
  readonly process: OwnedProcess;
  readonly cleanupCalls: () => number;
  readonly exitLate: () => void;
} => {
  const completion = Promise.withResolvers<ProcessExit>();
  let cleanupCalls = 0;
  const process: OwnedProcess = {
    completion: completion.promise,
    identity: processIdentity(),
    terminateAndReap: async () => {
      cleanupCalls += 1;
      return confirmedCleanup(fixtureProcessExit({ exitCode: 1 }));
    },
    transport: {
      input: new WritableStream<Uint8Array>(),
      output: new ReadableStream<Uint8Array>(),
    },
  };
  return Object.freeze({
    cleanupCalls: () => cleanupCalls,
    exitLate: () => completion.resolve({ exitCode: 1, signal: null }),
    process,
  });
};

const countingProcessSpawner = (
  delegate: ProcessSpawner,
): { readonly cleanupCalls: () => number; readonly spawner: ProcessSpawner } => {
  let cleanupCalls = 0;
  const spawner: ProcessSpawner = {
    start: async (launch, signal) => {
      const process = await delegate.start(launch, signal);
      return Object.freeze({
        ...process,
        terminateAndReap: async () => {
          cleanupCalls += 1;
          return process.terminateAndReap();
        },
      });
    },
  };
  return Object.freeze({ cleanupCalls: () => cleanupCalls, spawner });
};

const nativeSubject: ProtocolDriverContractSubject = Object.freeze({
  name: 'fake native',
  start: async (
    directory: string,
    scenario: ProtocolDriverContractScenario,
    options: { readonly resultSchema?: Readonly<Record<string, unknown>> } = {},
  ) => {
    const activeState = activeStateStory();
    const process = fakeOwnedProcess();
    const native = fakeNativeProtocolDriver(nativeScenarioFor(scenario), {
      cancelThrows: scenario === 'cancel',
    });
    const processes: ProcessSpawner = { start: async () => process.process };
    const manager = createAgentManager(
      {
        activeStateSink: activeState.sink,
        definitions: [agentDefinition()],
        redaction: { secrets: ['contract-vendor-secret'] },
      },
      managerServices({ executor: createInvocationExecutor(processes, native.driver) }),
    );
    await manager.initialize([]);
    const request = contractRequest(
      directory,
      scenario,
      options.resultSchema ?? { type: 'object' },
    );
    return contractRun(manager, activeState, request, {
      input: native.input,
      lateProcessExit: process.exitLate,
      processCleanupCalls: process.cleanupCalls,
      providerCancelCalls: async () => native.cancelCalls(),
      providerCloseCalls: async () => native.closeCalls(),
      providerPermissionDecision: async () => native.permissionDecision(),
      ready: () => waitForInput(native.input),
      wroteAfterClose: native.wroteAfterClose,
    });
  },
});

const acpSubject: ProtocolDriverContractSubject = Object.freeze({
  name: 'ACP',
  start: async (
    directory: string,
    scenario: ProtocolDriverContractScenario,
    options: { readonly resultSchema?: Readonly<Record<string, unknown>> } = {},
  ) => {
    const activeState = activeStateStory();
    const traceFile = join(directory, `${scenario}.acp.trace.json`);
    const readyFile = join(directory, `${scenario}.acp.ready`);
    const captured: { value?: ProtocolDriverInput } = {};
    const processes = countingProcessSpawner(nodeProcessSpawner);
    const manager = createAgentManager(
      {
        activeStateSink: activeState.sink,
        definitions: [fakeAcpDefinition({ mode: acpModeFor(scenario), readyFile, traceFile })],
        redaction: { secrets: ['contract-vendor-secret'] },
      },
      managerServices({
        executablePreflight: definitionCommandPreflight,
        executor: createInvocationExecutor(
          processes.spawner,
          captureProtocolDriver(acpProtocolDriver, captured),
        ),
      }),
    );
    await manager.initialize([]);
    const request = contractRequest(
      directory,
      scenario,
      options.resultSchema ?? { type: 'object' },
    );
    const trace = async (): Promise<CapturedAcpTrace> => traceAt(traceFile);
    return contractRun(manager, activeState, request, {
      input: () => captured.value,
      lateProcessExit: () => undefined,
      processCleanupCalls: processes.cleanupCalls,
      providerCancelCalls: async () => (await trace()).cancelCalls,
      providerCloseCalls: async () => (await trace()).closeCalls,
      ready: async () => {
        await Promise.all([waitForFile(readyFile), waitForInput(() => captured.value)]);
      },
    });
  },
});

export const protocolDriverContractSubjects: readonly ProtocolDriverContractSubject[] =
  Object.freeze([acpSubject, nativeSubject]);
