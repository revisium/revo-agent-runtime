export type {
  AgentDefinition,
  AgentDefinitionInput,
  AgentRef,
} from './contracts/agent-definition.js';
export type {
  AgentConfigurationBooleanOption,
  AgentConfigurationCatalog,
  AgentConfigurationKnownModel,
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
  AgentManagerInitialization,
  AgentFault,
  AgentFaultDetails,
  AgentFaultDiagnostic,
  AgentManagerLimits,
  AgentManagerOptions,
  AgentStartContext,
  CancelInvocationResult,
  StartAgentInvocation,
  Unsubscribe,
} from './contracts/manager.js';
export { AgentManagerError } from './contracts/manager.js';
export type {
  ActiveAgentSessionSnapshot,
  ActiveAgentSessionStateMutationResult,
  ActiveAgentSessionStateSink,
  AgentProgressEvent,
  AgentSession,
  AgentSessionAction,
  AgentSessionAgentDescriptor,
  AgentSessionCapabilities,
  AgentSessionCheckpoint,
  AgentSessionCommandContext,
  AgentSessionEvent,
  AgentSessionEventAppendPrecondition,
  AgentSessionEventAppendResult,
  AgentSessionEventBase,
  AgentSessionEventCursor,
  AgentSessionEventSink,
  AgentSessionFilter,
  AgentSessionHibernateResult,
  AgentSessionInputValue,
  AgentSessionInteractionScope,
  AgentSessionInteractiveRequest,
  AgentSessionInteractiveResponse,
  AgentSessionLaunchContext,
  AgentSessionLaunchInput,
  AgentSessionLimits,
  AgentSessionManagerLimits,
  AgentSessionManagerOptions,
  AgentSessionMessage,
  AgentSessionOutputFiles,
  AgentSessionOutputPublication,
  AgentSessionPendingInteraction,
  AgentSessionPermissionOption,
  AgentSessionPlanItem,
  AgentSessionQuestion,
  AgentSessionResumeToken,
  AgentSessions,
  AgentSessionSnapshot,
  AgentSessionStatus,
  AgentSessionTerminalFilter,
  AgentSessionTerminalRecord,
  AgentSessionTurn,
  AgentSessionTurnOutcome,
  AgentSessionTurnResult,
  AgentSessionTurnSnapshot,
  AgentSessionUsage,
  AssistantMessageCompletedEvent,
  AssistantMessageDeltaEvent,
  CancelAgentSessionResult,
  CancelAgentSessionTurnResult,
  CloseAgentSessionResult,
  InteractionRequestedEvent,
  InteractionResolvedEvent,
  OpenAgentSession,
  PlanUpdatedEvent,
  RespondAgentSessionRequest,
  RespondAgentSessionResult,
  ResumeAgentSession,
  SendAgentSessionInput,
  SessionAcceptedEvent,
  SessionCheckpointedEvent,
  SessionClosedEvent,
  SessionHibernatedEvent,
  SessionOpenedEvent,
  ToolActivityEvent,
  TurnCompletedEvent,
  TurnStartedEvent,
  UsageUpdatedEvent,
} from './contracts/session.js';
import { createAgentManager as createManager } from './application/manager/manager.js';
import { createAgentSessionComposer } from './composition/session/manager.js';
import { createConfigurationInspector } from './execution/configuration/inspector.js';
import { createConfigurationServerSpawner } from './execution/configuration/server-process.js';
import { createInvocationExecutor } from './execution/invocation/executor.js';
import { createExecutablePreflight } from './execution/probe/executable-preflight.js';
import { nodeOutputClaimPlatform } from './platform/node/output/claim.js';
import { nodeClaimedOutputPublisher } from './platform/node/output/publication.js';
import { createNodeSessionOutputTarget } from './platform/node/output/session/publication.js';
import { nodeExecutableProbe } from './platform/node/probe/executable-probe.js';
import { nodeSha256Digest } from './platform/node/security/digest.js';
import { nodeSessionIdentitySource } from './platform/node/session/primitives/identity.js';
import { nodeRecoveredProcessInspector, nodeProcessSpawner } from './process/node.js';
import { createAcpConfigurationDriver } from './protocol/acp/configuration-inspector.js';
import { createAcpProtocolDriver } from './protocol/acp/driver.js';
import { createAcpSessionProtocolDriver } from './protocol/acp/session/driver.js';
import {
  builtInConfigurationCompatibility,
  builtInConfigurationFallback,
} from './providers/index.js';
import { createOpenCodeCatalogEnricher } from './providers/opencode/catalog.js';

const acpProtocolDriver = createAcpProtocolDriver(builtInConfigurationCompatibility);
const acpConfigurationDriver = createAcpConfigurationDriver(builtInConfigurationCompatibility);
const configurationEnrichers = new Map([
  [
    'opencode-acp',
    createOpenCodeCatalogEnricher(createConfigurationServerSpawner(nodeProcessSpawner)),
  ],
]);
const sessionComposer = createAgentSessionComposer({
  hostEnvironment: () => process.env,
  digest: nodeSha256Digest,
  driver: createAcpSessionProtocolDriver(builtInConfigurationCompatibility),
  executablePreflight: createExecutablePreflight(nodeExecutableProbe),
  identities: nodeSessionIdentitySource,
  outputClaimPlatform: nodeOutputClaimPlatform,
  outputTarget: createNodeSessionOutputTarget,
  recoveryInspector: nodeRecoveredProcessInspector,
  spawner: nodeProcessSpawner,
});

export const createAgentManager = (options: import('./contracts/manager.js').AgentManagerOptions) =>
  createManager(options, {
    configurationInspector: createConfigurationInspector(
      nodeProcessSpawner,
      acpConfigurationDriver,
      builtInConfigurationFallback,
      (definitionId) => configurationEnrichers.get(definitionId),
    ),
    executablePreflight: createExecutablePreflight(nodeExecutableProbe),
    executor: createInvocationExecutor(nodeProcessSpawner, acpProtocolDriver),
    outputClaimPlatform: nodeOutputClaimPlatform,
    outputPublisher: nodeClaimedOutputPublisher,
    recoveryInspector: nodeRecoveredProcessInspector,
    sessionComposer,
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
