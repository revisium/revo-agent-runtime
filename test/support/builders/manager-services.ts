import type { ManagerServices } from '../../../src/application/manager/manager.js';
import type {
  AgentDefinition,
  AgentDefinitionInput,
} from '../../../src/contracts/agent-definition.js';
import type { AgentManagerOptions } from '../../../src/contracts/manager.js';
import type { AgentConfigurationInspector } from '../../../src/execution/configuration/inspector.js';
import type { InvocationExecutor } from '../../../src/execution/invocation/executor.js';
import type { OutputClaimPlatform } from '../../../src/execution/output/claim.js';
import type { ClaimedInvocationOutputPublisher } from '../../../src/execution/output/publication.js';
import type { ExecutablePreflight } from '../../../src/execution/probe/executable-preflight.js';
import type { RecoveredProcessInspector } from '../../../src/execution/process/port.js';
import { noOpActiveStateSink } from '../stories/active-state.js';
import { fixtureExecutionEvidence, terminalDrainage } from './execution-evidence.js';
import { processIdentity } from './process-identity.js';

export const unavailableRecoveryInspector: RecoveredProcessInspector = Object.freeze({
  inspectAndReconcileRecoveredProcess: async () => ({ status: 'inconclusive' as const }),
});

export const definitionCommandPreflight: ExecutablePreflight = Object.freeze({
  probe: async (definition: AgentDefinition) =>
    Object.freeze({
      launch: Object.freeze({ executable: definition.launch.command, reportedVersion: 'fixture' }),
      status: 'ready' as const,
    }),
});

export const managerOptions = (
  definitions: readonly AgentDefinitionInput[],
): AgentManagerOptions => ({
  activeStateSink: noOpActiveStateSink,
  definitions,
});

const acceptedExecutor = (): InvocationExecutor => ({
  start: (request) => {
    const outcome = { status: 'succeeded' as const, value: {} };
    return {
      admission: Promise.resolve({
        identity: processIdentity(),
        launch: request.launch,
        status: 'accepted' as const,
      }),
      completion: Promise.resolve(outcome),
      drainage: Promise.resolve(terminalDrainage(request, outcome)),
      activate: request.onStarted,
      cancel: () => false,
      evidence: () => fixtureExecutionEvidence(request),
    };
  },
});

export const managerServices = (overrides: Partial<ManagerServices> = {}): ManagerServices => {
  const configurationInspector: AgentConfigurationInspector = {
    inspect: async (request) => ({
      catalog: { catalogRevision: 'fixture', options: [] },
      launch: request.launch,
      status: 'completed',
    }),
  };
  const outputClaimPlatform: OutputClaimPlatform = {
    createExclusiveDirectory: async () => 'created',
    inspectDirectory: async () => 'directory',
  };
  const executablePreflight: ExecutablePreflight = {
    probe: async () => ({
      launch: { executable: '/fixture/agent', reportedVersion: '1.0.0' },
      status: 'ready',
    }),
  };
  const outputPublisher: ClaimedInvocationOutputPublisher = {
    publish: async () => ({
      files: ['events.ndjson', 'stdout.log', 'stderr.log', 'result.json'],
      status: 'published',
    }),
  };
  const recoveryInspector: RecoveredProcessInspector = {
    inspectAndReconcileRecoveredProcess: async () => ({ status: 'absent' }),
  };
  return Object.freeze({
    configurationInspector,
    executor: acceptedExecutor(),
    executablePreflight,
    outputClaimPlatform,
    outputPublisher,
    recoveryInspector,
    ...overrides,
  });
};
