import type { AgentRef } from '../../contracts/agent-definition.js';
import type {
  AgentConfigurationCatalog,
  InspectAgentConfiguration,
} from '../../contracts/configuration.js';
import {
  AgentManagerError,
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
import { EffectiveInvocationInputPolicy } from '../admission/effective-inputs.js';
import { activeStateError, fault, managerError } from '../faults/agent-faults.js';
import type { AgentSessionComposer } from '../session/management/composition.js';
import { createUnavailableAgentSessions } from '../session/management/unavailable.js';
import { AgentCatalog } from './agent-catalog.js';
import { EventSubscriptions } from './events.js';
import { decodeManagerInitialization } from './initialization-input.js';
import { ManagerInitialization } from './initialization.js';
import { InvocationQueries } from './invocation-queries.js';
import { ManagedConfigurations } from './managed-configurations.js';
import { ManagedInvocations } from './managed-invocations.js';
import { ManagedAgentProbes } from './managed-probes.js';
import { validateManagerOptions } from './options.js';
import { PendingOperations } from './pending-operations.js';
import { createManagerSessionFacade } from './session-facade.js';

export interface ManagerServices {
  readonly configurationInspector: AgentConfigurationInspector;
  readonly executor: InvocationExecutor;
  readonly executablePreflight: ExecutablePreflight;
  readonly outputClaimPlatform: OutputClaimPlatform;
  readonly outputPublisher: ClaimedInvocationOutputPublisher;
  readonly recoveryInspector: RecoveredProcessInspector;
  readonly sessionComposer?: AgentSessionComposer;
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
  if (validated.sessions !== undefined && services.sessionComposer === undefined)
    throw managerError('revo.agent.internal', 'Session composition is unavailable.');
  const sessionController =
    validated.sessions === undefined || services.sessionComposer === undefined
      ? undefined
      : services.sessionComposer.create({
          agents: catalog.list(),
          definitions,
          options: validated.sessions,
        });
  const managedSessions =
    sessionController?.sessions ?? createUnavailableAgentSessions(catalog.list());
  let closed = false;
  let ready = false;
  let managerInitialization: Promise<void> | undefined;
  let shutdown: Promise<void> | undefined;

  const requireReady = (): void => {
    if (!ready)
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

  const initialize = (snapshots: unknown): Promise<void> => {
    if (closed)
      return Promise.reject(managerError('revo.agent.manager_closed', 'Agent manager is closed.'));
    if (managerInitialization !== undefined) return managerInitialization;
    const input = decodeManagerInitialization(snapshots);
    if (input === undefined) {
      const invalid = Promise.reject(activeStateError('manager'));
      managerInitialization = invalid;
      void invalid.catch(() => {
        managerInitialization = undefined;
      });
      return invalid;
    }
    if (
      sessionController === undefined &&
      (!Array.isArray(input.sessions) || input.sessions.length > 0)
    )
      return Promise.reject(
        managerError('revo.agent.session_state_unavailable', 'Session recovery is not configured.'),
      );
    const attempt = Promise.all([
      initialization.initialize(input.invocations),
      sessionController?.initialize(input.sessions) ?? Promise.resolve(),
    ]).then(() => {
      ready = true;
    });
    managerInitialization = attempt;
    void attempt.catch(async () => {
      await Promise.all([
        initialization.whenQuiescent(),
        sessionController?.whenInitializationQuiescent() ?? Promise.resolve(),
      ]);
      managerInitialization = undefined;
    });
    return attempt;
  };

  const shutdownManager = (reason?: string): Promise<void> => {
    if (shutdown !== undefined) return shutdown;
    closed = true;
    pendingOperations.cancelAll();
    invocations.cancelAll();
    shutdown = Promise.all([
      pendingOperations.quiesce(),
      sessionController?.shutdown(reason) ?? Promise.resolve(),
    ]).then(async () => {
      const invocationsQuiescent = await invocations.quiesce();
      subscriptions.clear();
      if (
        !invocationsQuiescent ||
        initialization.unresolved ||
        (!ready && managerInitialization !== undefined) ||
        pendingOperations.size > 0
      )
        throw shutdownError();
    });
    return shutdown;
  };

  const sessions = createManagerSessionFacade(managedSessions, { requireOpen, requireReady });

  return Object.freeze({
    cancel: async (invocationId: string): Promise<CancelInvocationResult> => {
      if (!ready) requireOpen();
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
    sessions,
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
