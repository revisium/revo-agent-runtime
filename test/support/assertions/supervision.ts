import type { AgentArgumentTemplate } from '../../../src/contracts/agent-definition.js';
import { createSealedAgentRegistry } from '../../../src/definition/index.js';
import {
  createInvocationExecutor,
  type InvocationExecution,
} from '../../../src/execution/invocation/executor.js';
import type {
  OwnedProcess,
  ProcessCleanupOutcome,
  ProcessExit,
  ProcessLaunch,
  ProcessSpawner,
} from '../../../src/execution/process/port.js';
import type {
  ProtocolDriver,
  ProtocolObserver,
  ProtocolSession,
} from '../../../src/protocol/driver.js';
import { agentDefinition } from '../builders/agent-definition.js';
import {
  confirmedCleanup,
  fixtureLaunchEvidence,
  fixtureProcessExit,
} from '../builders/execution-evidence.js';

export interface SupervisionScenario {
  readonly execution: InvocationExecution;
  readonly events: readonly string[];
  readonly providerCancelCalls: () => number;
  readonly providerCloseCalls: () => number;
  readonly cleanupCalls: () => number;
  readonly processStartCalls: () => number;
  admit(): Promise<void>;
  accept(): Promise<void>;
  activate(): void;
  agentCompletes(value: Record<string, unknown>): Promise<void>;
  agentConnectionFails(): Promise<void>;
  agentFails(): Promise<void>;
  protocolFailsLate(): void;
  protocolOpensLate(): void;
  writeProcessOutput(output: { readonly stdout?: string; readonly stderr?: string }): void;
  validActivity(): Promise<void>;
  processExits(): void;
}

export const controlledSupervision = (
  options: {
    readonly cleanup?: ProcessCleanupOutcome['status'] | 'throw';
    readonly cancellation?: boolean;
    readonly providerCancel?: 'resolve' | 'reject' | 'throw';
    readonly providerClose?: 'resolve' | 'reject' | 'throw';
    readonly protocolOpen?: 'controlled' | 'pending' | 'reject' | 'resolve';
    readonly processStart?: 'reject' | 'resolve';
    readonly launchArgs?: readonly AgentArgumentTemplate[];
    readonly wallClockTimeoutMs?: number;
    readonly idleTimeoutMs?: number;
  } = {},
): SupervisionScenario => {
  const processCompletion = Promise.withResolvers<ProcessExit>();
  const protocolCompletion = Promise.withResolvers<{
    readonly status: 'completed' | 'failed';
  }>();
  const controlledProtocolOpen = Promise.withResolvers<ProtocolSession>();
  const protocolReady = Promise.withResolvers<ProtocolObserver>();
  const events: string[] = [];
  let cleanupCalls = 0;
  let providerCancelCalls = 0;
  let providerCloseCalls = 0;
  let processStartCalls = 0;
  let processLaunch: ProcessLaunch | undefined;

  const protocolSession: ProtocolSession = {
    cancel: () => {
      providerCancelCalls += 1;
      if (options.providerCancel === 'throw') throw new Error('provider cancel failed');
      return options.providerCancel === 'reject'
        ? Promise.reject(new Error('provider cancel failed'))
        : Promise.resolve();
    },
    close: () => {
      providerCloseCalls += 1;
      if (options.providerClose === 'throw') throw new Error('provider close failed');
      return options.providerClose === 'reject'
        ? Promise.reject(new Error('provider close failed'))
        : Promise.resolve();
    },
    completion: protocolCompletion.promise,
  };

  const process: OwnedProcess = {
    completion: processCompletion.promise,
    identity: {
      fingerprint: 'sha256:fixture',
      pid: 100,
      processGroupId: 100,
      startedAt: '2026-01-01T00:00:00.000Z',
    },
    terminateAndReap: async () => {
      cleanupCalls += 1;
      if (options.cleanup === 'throw') throw new Error('fixture cleanup failed');
      if (options.cleanup === 'uncertain') return { status: 'uncertain' };
      return confirmedCleanup(fixtureProcessExit());
    },
    transport: {
      input: new WritableStream<Uint8Array>(),
      output: new ReadableStream<Uint8Array>(),
    },
  };
  const processes: ProcessSpawner = {
    start: async (launch) => {
      processStartCalls += 1;
      processLaunch = launch;
      if (options.processStart === 'reject') throw new Error('fixture process start failed');
      return process;
    },
  };
  const protocol: ProtocolDriver = {
    open: async (request) => {
      protocolReady.resolve(request.observer);
      if (options.protocolOpen === 'pending') return new Promise(() => undefined);
      if (options.protocolOpen === 'reject') throw new Error('protocol open failed');
      if (options.protocolOpen === 'controlled') return controlledProtocolOpen.promise;
      return protocolSession;
    },
  };
  const definition = createSealedAgentRegistry([
    agentDefinition({
      capabilities: {
        cancellation: options.cancellation ?? true,
        structuredResult: true,
        usage: false,
      },
      launch: {
        args: options.launchArgs ?? [],
        command: '/fixture/agent',
        versionProbe: { args: ['--version'], stream: 'stdout', timeoutMs: 1_000 },
      },
      protocol: { driver: 'acp/v1', permissionStrategy: 'acp/v1' },
    }),
  ]).list()[0]!.definition;
  const execution = createInvocationExecutor(processes, protocol).start({
    definition,
    idleTimeoutMs: options.idleTimeoutMs ?? 60_000,
    launch: fixtureLaunchEvidence,
    onCancelling: () => events.push('cancelling'),
    onStarted: () => events.push('started'),
    parameters: {},
    permissions: {},
    prompt: 'Wait for controlled supervision.',
    resultSchema: { type: 'object' },
    wallClockTimeoutMs: options.wallClockTimeoutMs ?? 60_000,
    workspace: '/fixture/workspace',
  });

  return {
    execution,
    events,
    providerCancelCalls: () => providerCancelCalls,
    providerCloseCalls: () => providerCloseCalls,
    processStartCalls: () => processStartCalls,
    cleanupCalls: () => cleanupCalls,
    admit: async () => {
      const admission = await execution.admission;
      if (admission.status !== 'accepted') throw new Error('Expected accepted execution.');
    },
    accept: async () => {
      const admission = await execution.admission;
      if (admission.status !== 'accepted') throw new Error('Expected accepted execution.');
      execution.activate();
      await protocolReady.promise;
    },
    activate: () => execution.activate(),
    agentCompletes: async (value) => {
      const observer = await protocolReady.promise;
      observer.resultChunk(new TextEncoder().encode(JSON.stringify(value)));
      protocolCompletion.resolve({ status: 'completed' });
    },
    agentConnectionFails: async () => protocolCompletion.reject(new Error('connection failed')),
    agentFails: async () => protocolCompletion.resolve({ status: 'failed' }),
    protocolFailsLate: () => controlledProtocolOpen.reject(new Error('late protocol failure')),
    protocolOpensLate: () => controlledProtocolOpen.resolve(protocolSession),
    writeProcessOutput: (output) => {
      if (processLaunch === undefined) throw new Error('Expected a started fixture process.');
      if (output.stdout !== undefined)
        processLaunch.onStdout?.(new TextEncoder().encode(output.stdout));
      if (output.stderr !== undefined)
        processLaunch.onStderr?.(new TextEncoder().encode(output.stderr));
    },
    validActivity: async () => (await protocolReady.promise).activity(),
    processExits: () => processCompletion.resolve({ exitCode: 0, signal: null }),
  };
};

export const remainsPending = async (promise: Promise<unknown>): Promise<boolean> => {
  const marker = Symbol('pending');
  return (await Promise.race([promise, Promise.resolve(marker)])) === marker;
};

export const captureRejection = <Value>(operation: Promise<Value>): Promise<unknown> =>
  operation.then(
    () => {
      throw new Error('Expected the operation to reject.');
    },
    (reason: unknown) => reason,
  );
