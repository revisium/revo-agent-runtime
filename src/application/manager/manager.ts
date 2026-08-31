import type { AgentRef } from '../../contracts/agent-definition.js';
import type {
  AgentConfigurationCatalog,
  InspectAgentConfiguration,
} from '../../contracts/configuration.js';
import {
  AgentManagerError,
  type ActiveInvocationSnapshot,
  type AgentEventFilter,
  type AgentEventListener,
  type AgentInvocationFilter,
  type AgentInvocationSnapshot,
  type AgentManager,
  type AgentManagerOptions,
  type AgentResultLookup,
  type AgentStartContext,
  type CancelInvocationResult,
  type StartAgentInvocation,
  type Unsubscribe,
} from '../../contracts/manager.js';
import type { AgentConfigurationInspector } from '../../execution/configuration/inspector.js';
import type { InvocationExecutor } from '../../execution/invocation/executor.js';
import type { OutputClaimPlatform } from '../../execution/output/claim.js';
import type { ClaimedInvocationOutputPublisher } from '../../execution/output/publication.js';
import type { ExecutablePreflight } from '../../execution/probe/executable-preflight.js';
import type { RecoveredProcessInspector } from '../../execution/process/port.js';
import { fault, managerError } from '../faults/agent-faults.js';
import { EffectiveInvocationInputPolicy } from '../invocation/input/effective-invocation-inputs.js';
import { AgentCatalog } from './agent-catalog.js';
import { EventSubscriptions } from './events.js';
import { ManagerInitialization } from './initialization.js';
import { InvocationQueries } from './invocation-queries.js';
import { ManagedConfigurations } from './managed-configurations.js';
import { ManagedInvocations } from './managed-invocations.js';
import { ManagedAgentProbes } from './managed-probes.js';
import { validateManagerOptions } from './options.js';
import { PendingOperations } from './pending-operations.js';

export interface ManagerServices {
  readonly configurationInspector: AgentConfigurationInspector;
  readonly executor: InvocationExecutor;
  readonly executablePreflight: ExecutablePreflight;
  readonly outputClaimPlatform: OutputClaimPlatform;
  readonly outputPublisher: ClaimedInvocationOutputPublisher;
  readonly recoveryInspector: RecoveredProcessInspector;
}

const shutdownError = (): AgentManagerError =>
  new AgentManagerError(
    fault(
      'revo.agent.shutdown_failed',
      'Agent manager shutdown could not confirm process cleanup.',
      'shutdown',
    ),
  );

export const createAgentManager = (
  options: AgentManagerOptions,
  services: ManagerServices,
): AgentManager => {
  const validated = validateManagerOptions(options);
  const definitions = validated.definitions;
  const catalog = new AgentCatalog(definitions);
  const subscriptions = new EventSubscriptions();
  const queries = new InvocationQueries(validated.limits.maxCompletedInvocations);
  const pendingOperations = new PendingOperations();
  const initialization = new ManagerInitialization(
    definitions,
    validated.activeStateSink,
    services.recoveryInspector,
    validated.limits,
  );
  let closed = false;
  let shutdown: Promise<void> | undefined;

  const requireReady = (): void => {
    if (!initialization.ready)
      throw managerError('revo.agent.manager_not_initialized', 'Agent manager is not initialized.');
  };
  const requireOpen = (): void => {
    if (closed) throw managerError('revo.agent.manager_closed', 'Agent manager is closed.');
    requireReady();
  };
  const invocations = new ManagedInvocations({
    activeStateSink: validated.activeStateSink,
    definitions,
    executor: services.executor,
    executablePreflight: services.executablePreflight,
    inputPolicy: EffectiveInvocationInputPolicy.create(definitions.list()),
    isClosed: () => closed,
    limits: validated.limits,
    outputClaimPlatform: services.outputClaimPlatform,
    outputPublisher: services.outputPublisher,
    pendingOperations,
    queries,
    redactionSecrets: validated.redaction.secrets,
    subscriptions,
  });
  const probes = new ManagedAgentProbes(
    catalog,
    services.executablePreflight,
    pendingOperations,
    () => closed,
  );
  const configurations = new ManagedConfigurations(
    catalog,
    services.configurationInspector,
    services.executablePreflight,
    validated.limits,
    pendingOperations,
    () => closed,
  );

  const initialize = (snapshots: readonly ActiveInvocationSnapshot[]): Promise<void> => {
    if (closed)
      return Promise.reject(managerError('revo.agent.manager_closed', 'Agent manager is closed.'));
    return initialization.initialize(snapshots);
  };

  const shutdownManager = (): Promise<void> => {
    if (shutdown !== undefined) return shutdown;
    closed = true;
    pendingOperations.cancelAll();
    invocations.cancelAll();
    shutdown = pendingOperations.quiesce().then(async () => {
      const invocationsQuiescent = await invocations.quiesce();
      subscriptions.clear();
      if (!invocationsQuiescent || initialization.unresolved || pendingOperations.size > 0)
        throw shutdownError();
    });
    return shutdown;
  };

  return Object.freeze({
    cancel: async (invocationId: string): Promise<CancelInvocationResult> => {
      if (!initialization.ready) requireOpen();
      return invocations.cancel(invocationId);
    },
    getAgent: (agent: AgentRef) => catalog.get(agent),
    inspectConfiguration: async (
      request: InspectAgentConfiguration,
      context?: AgentStartContext,
    ): Promise<AgentConfigurationCatalog> => {
      requireOpen();
      return configurations.inspect(request, context);
    },
    getInvocation: (invocationId: string): AgentInvocationSnapshot | undefined => {
      requireReady();
      return queries.getInvocation(invocationId);
    },
    getResult: (invocationId: string): AgentResultLookup => {
      requireReady();
      return queries.getResult(invocationId);
    },
    initialize,
    listAgents: () => catalog.list(),
    listInvocations: (filter?: AgentInvocationFilter): readonly AgentInvocationSnapshot[] => {
      requireReady();
      return queries.listInvocations(filter);
    },
    probeAgent: async (agent: AgentRef) => {
      requireOpen();
      return probes.probe(agent);
    },
    shutdown: shutdownManager,
    start: async (request: StartAgentInvocation, context?: AgentStartContext) => {
      requireOpen();
      return invocations.start(request, context);
    },
    subscribe: (filter: AgentEventFilter, listener: AgentEventListener): Unsubscribe => {
      requireOpen();
      return subscriptions.subscribe(filter, listener);
    },
    waitForResult: (invocationId: string) => {
      requireReady();
      return queries.waitForResult(invocationId);
    },
  });
};
