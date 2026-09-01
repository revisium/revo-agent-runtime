import type { AgentInvocationResult } from '../../../src/contracts/manager.js';
import { validateAgentDefinition } from '../../../src/definition/index.js';
import {
  createInvocationExecutor,
  type ExecutionAdmission,
  type ExecutionDrainage,
  type ExecutionEvidence,
  type ExecutionOutcome,
  type InvocationExecution,
  type InvocationExecutionRequest,
} from '../../../src/execution/invocation/executor.js';
import type {
  OwnedProcess,
  ProcessCleanupOutcome,
  ProcessExit,
  ProcessLaunch,
} from '../../../src/execution/process/port.js';
import type { ProtocolDriver } from '../../../src/protocol/driver.js';
import { agentDefinition } from './agent-definition.js';
import { processIdentity } from './process-identity.js';

export const fixtureLaunchEvidence: InvocationExecutionRequest['launch'] = Object.freeze({
  executable: '/fixture/agent',
  reportedVersion: '1.0.0',
});

export const fixtureProcessExit = (overrides: Partial<ProcessExit> = {}): ProcessExit =>
  Object.freeze({
    exitCode: 0,
    signal: null,
    ...overrides,
  });

export const fixtureExecutionEvidence = (
  request: Pick<InvocationExecutionRequest, 'launch'>,
  exit: ProcessExit = fixtureProcessExit(),
): ExecutionEvidence =>
  Object.freeze({
    launch: request.launch,
    processExit: exit,
  });

export const acceptedAdmission = (
  request: Pick<InvocationExecutionRequest, 'launch'>,
): ExecutionAdmission =>
  Object.freeze({
    identity: processIdentity(),
    launch: request.launch,
    status: 'accepted',
  });

export const confirmedCleanup = (exit: ProcessExit = fixtureProcessExit()): ProcessCleanupOutcome =>
  Object.freeze({
    exit,
    status: 'confirmed',
  });

export const terminalDrainage = (
  request: Pick<InvocationExecutionRequest, 'launch'>,
  outcome: ExecutionOutcome,
  exit: ProcessExit = fixtureProcessExit(),
): ExecutionDrainage =>
  Object.freeze({
    evidence: fixtureExecutionEvidence(request, exit),
    outcome,
    status: 'terminal',
  });

export const fixtureInvocationResult = (directory: string): AgentInvocationResult => {
  const exit = fixtureProcessExit();
  return Object.freeze({
    acceptedAt: '2026-08-30T00:00:00.000Z',
    durationMs: 1_000,
    exit: Object.freeze({ code: exit.exitCode, signal: exit.signal }),
    files: Object.freeze({
      directory,
      events: 'events.ndjson' as const,
      result: 'result.json' as const,
      stderr: 'stderr.log' as const,
      stdout: 'stdout.log' as const,
    }),
    finishedAt: '2026-08-30T00:00:01.000Z',
    invocationId: 'fixture-invocation',
    launch: fixtureLaunchEvidence,
    pin: Object.freeze({
      agentId: 'codex',
      agentVersion: '1.0.0',
      definitionDigest: 'sha256:fixture',
    }),
    schemaVersion: 'agent-invocation-result/v1' as const,
    status: 'succeeded' as const,
    value: Object.freeze({}),
  });
};

export interface ExecutionEvidenceStory {
  readonly execution: InvocationExecution;
  readonly launch: () => ProcessLaunch | undefined;
  readonly resolveProcessExit: (exit: ProcessExit) => void;
  readonly cleanup: () => Promise<void>;
}

export const executionEvidenceStory = (): ExecutionEvidenceStory => {
  const processExit = Promise.withResolvers<ProcessExit>();
  const cleanupStarted = Promise.withResolvers<void>();
  let capturedLaunch: ProcessLaunch | undefined;
  const process: OwnedProcess = {
    completion: processExit.promise,
    identity: {
      fingerprint: 'sha256:fixture',
      pid: 100,
      processGroupId: 100,
      startedAt: '2026-01-01T00:00:00.000Z',
    },
    terminateAndReap: async () => {
      cleanupStarted.resolve();
      const exit = await processExit.promise;
      return confirmedCleanup(exit);
    },
    transport: {
      input: new WritableStream<Uint8Array>(),
      output: new ReadableStream<Uint8Array>(),
    },
  };
  const protocol: ProtocolDriver = {
    open: async (request) => {
      request.observer.resultChunk(new TextEncoder().encode('{"answer":"accepted"}'));
      return {
        cancel: async () => undefined,
        close: async () => undefined,
        completion: Promise.resolve({ status: 'completed' }),
      };
    },
  };
  const definition = validateAgentDefinition(agentDefinition()).definition;
  const execution = createInvocationExecutor(
    {
      start: async (launch) => {
        capturedLaunch = launch;
        return process;
      },
    },
    protocol,
  ).start({
    definition,
    idleTimeoutMs: 60_000,
    launch: Object.freeze({ executable: '/resolved/agent', reportedVersion: '1.2.3' }),
    onCancelling: () => undefined,
    onStarted: () => undefined,
    parameters: {},
    permissions: {},
    prompt: 'Return evidence.',
    resultSchema: { type: 'object' },
    wallClockTimeoutMs: 60_000,
    workspace: '/fixture/workspace',
  });
  return Object.freeze({
    cleanup: () => cleanupStarted.promise,
    execution,
    launch: () => capturedLaunch,
    resolveProcessExit: processExit.resolve,
  });
};
