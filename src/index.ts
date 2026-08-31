export type {
  AgentDefinition,
  AgentDefinitionInput,
  AgentRef,
} from './contracts/agent-definition.js';
export type {
  AgentConfigurationBooleanOption,
  AgentConfigurationCatalog,
  AgentConfigurationModelView,
  AgentConfigurationOption,
  AgentConfigurationProviderModels,
  AgentConfigurationSelection,
  AgentConfigurationSelectionValue,
  AgentConfigurationSelectOption,
  AgentConfigurationValue,
  InspectAgentConfiguration,
} from './contracts/configuration.js';
export type {
  ActiveInvocationSnapshot,
  ActiveInvocationStateSink,
  ActiveProcessIdentity,
  AgentEvent,
  AgentEventFilter,
  AgentEventListener,
  AgentDescriptor,
  AgentExecutionPin,
  AgentInvocationFilter,
  AgentInvocationHandle,
  AgentInvocationResult,
  AgentInvocationSnapshot,
  AgentInvocationStatus,
  AgentInvocationCancelled,
  AgentInvocationFailed,
  AgentInvocationSucceeded,
  AgentInvocationTimedOut,
  AgentCommittedOutputFiles,
  AgentOutputFiles,
  AgentRawResponseDiagnostic,
  AgentLaunchEvidence,
  AgentProcessExit,
  AgentProbeAvailable,
  AgentProbeResult,
  AgentProbeUnavailable,
  AgentUsage,
  AgentResultLookup,
  AgentManager,
  AgentFault,
  AgentManagerLimits,
  AgentManagerOptions,
  AgentStartContext,
  CancelInvocationResult,
  StartAgentInvocation,
  Unsubscribe,
} from './contracts/manager.js';
export { AgentManagerError } from './contracts/manager.js';
import { createAgentManager as createManager } from './application/manager/manager.js';
import { createConfigurationInspector } from './execution/configuration/inspector.js';
import { createInvocationExecutor } from './execution/invocation/executor.js';
import { createExecutablePreflight } from './execution/probe/executable-preflight.js';
import { nodeOutputClaimPlatform } from './platform/node/output/claim.js';
import { nodeClaimedOutputPublisher } from './platform/node/output/publication.js';
import { nodeExecutableProbe } from './platform/node/probe/executable-probe.js';
import { nodeRecoveredProcessInspector } from './platform/node/process/recovered-process.js';
import { nodeProcessSpawner } from './platform/node/process/spawner.js';
import { createAcpConfigurationDriver } from './protocol/acp/configuration-inspector.js';
import { createAcpProtocolDriver } from './protocol/acp/driver.js';
import {
  builtInConfigurationCompatibility,
  builtInConfigurationFallback,
} from './providers/index.js';

const acpProtocolDriver = createAcpProtocolDriver(builtInConfigurationCompatibility);
const acpConfigurationDriver = createAcpConfigurationDriver(builtInConfigurationCompatibility);

export const createAgentManager = (options: import('./contracts/manager.js').AgentManagerOptions) =>
  createManager(options, {
    configurationInspector: createConfigurationInspector(
      nodeProcessSpawner,
      acpConfigurationDriver,
      builtInConfigurationFallback,
    ),
    executablePreflight: createExecutablePreflight(nodeExecutableProbe),
    executor: createInvocationExecutor(nodeProcessSpawner, acpProtocolDriver),
    outputClaimPlatform: nodeOutputClaimPlatform,
    outputPublisher: nodeClaimedOutputPublisher,
    recoveryInspector: nodeRecoveredProcessInspector,
  });
export { discoverAgents } from './discovery/index.js';
export type {
  AgentDetector,
  AgentDetectorContext,
  AgentDetectorResult,
  AgentDiscoveryCandidate,
  AgentDiscoveryDiagnostic,
  AgentDiscoveryResult,
  DiscoverAgentsOptions,
  DiscoveredAgentModel,
  ModelObservation,
} from './contracts/discovery.js';
