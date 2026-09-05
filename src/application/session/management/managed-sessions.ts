import { AgentManagerError } from '../../../contracts/manager/core.js';
import type {
  AgentSession,
  AgentSessionLaunchContext,
  AgentSessionFilter,
  AgentSessionSnapshot,
  AgentSessionTerminalFilter,
  AgentSessionTerminalRecord,
  AgentSessions,
  CancelAgentSessionResult,
  OpenAgentSession,
  RespondAgentSessionRequest,
  RespondAgentSessionResult,
  ResumeAgentSession,
} from '../../../contracts/session.js';
import type {
  PublicCallSettlement,
  SessionCommandRuntime,
} from '../../../execution/session/runtime/actor/port.js';
import { resolveAgentSessionManagerLimits } from '../policy/limits/resolve.js';
import { SessionAgentCatalog } from './catalog.js';
import { sessionManagerError } from './errors.js';
import { createManagedSessionHandle } from './handle.js';
import { ManagedSessionOpeningBuilder, type PreparedManagedSessionOpening } from './opening.js';
import type { ManagedAgentSessionsOptions } from './options.js';
import { beginAgentSessionRecovery } from './recovery.js';
import { ManagedSessionRegistry } from './registry.js';

export type { ManagedAgentSessionsOptions } from './options.js';

const requireReady = async (
  runtime: SessionCommandRuntime,
  opening: PreparedManagedSessionOpening,
): Promise<void> => {
  const command = opening.command;
  const pending = runtime.registerCall(command.call.callId);
  runtime.dispatch(command);
  const settlement: PublicCallSettlement = await pending;
  if (settlement.state === 'rejected') throw new AgentManagerError(settlement.fault);
  if (settlement.resolution.kind !== 'session_ready')
    throw sessionManagerError(
      'revo.agent.internal',
      'Session opening returned an unexpected result.',
    );
};

export interface ManagedAgentSessionController {
  readonly sessions: AgentSessions;
  initialize(snapshots: unknown): Promise<void>;
  whenInitializationQuiescent(): Promise<void>;
  shutdown(reason?: string): Promise<void>;
}

export const createManagedAgentSessionController = (
  options: ManagedAgentSessionsOptions,
): ManagedAgentSessionController => {
  const catalog = new SessionAgentCatalog(options.agents);
  const registry = new ManagedSessionRegistry(resolveAgentSessionManagerLimits(options.limits));
  const openings = new ManagedSessionOpeningBuilder(options, catalog, registry);
  let accepting = true;
  let shutdown: Promise<void> | undefined;
  let initializationQuiescence: Promise<void> = Promise.resolve();

  const requireAccepting = (): void => {
    if (!accepting)
      throw sessionManagerError('revo.agent.manager_closed', 'Agent manager is closed.', 'manager');
  };

  const cancelRuntime = async (
    entry: ReturnType<ManagedSessionRegistry['activeEntries']>[number],
    reason?: string,
  ): Promise<void> => {
    if (entry.handle !== undefined) {
      await entry.handle.cancel(reason);
      return;
    }
    const observed = options.clock.now();
    const callId = options.nextIdentity('call');
    const settlement = entry.runtime.registerCall(callId);
    entry.runtime.dispatch({
      call: { callId, epoch: entry.epoch, sessionId: entry.sessionId },
      observedAt: observed.iso,
      observedAtMs: observed.milliseconds,
      ...(reason === undefined ? {} : { reason }),
      type: 'session.cancel',
    });
    await settlement;
  };

  const start = async (
    opening: PreparedManagedSessionOpening,
    signal?: AbortSignal,
  ): Promise<AgentSession> => {
    requireAccepting();
    const command = opening.command;
    const runtime = options.runtimeFactory.createOpening(command);
    registry.register(command.call.sessionId, opening.epoch, runtime);
    const cancel = (): void => {
      const entry = registry
        .activeEntries()
        .find(({ sessionId }) => sessionId === command.call.sessionId);
      if (entry !== undefined) void cancelRuntime(entry, 'Session opening was cancelled.');
    };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      await requireReady(runtime, opening);
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
    const handle = createManagedSessionHandle(options, registry, runtime, opening);
    registry.attach(command.call.sessionId, handle);
    return handle;
  };

  const sessions: AgentSessions = Object.freeze({
    cancel: async (id: string, reason?: string): Promise<CancelAgentSessionResult> => {
      const handle = registry.get(id);
      if (handle !== undefined) return handle.cancel(reason);
      if (registry.terminal(id) !== undefined) return { state: 'already_terminal' };
      throw sessionManagerError(
        'revo.agent.session_unknown',
        'The session is unknown.',
        'session_running',
      );
    },
    get: (id: string) => registry.get(id),
    getTerminal: (id: string): AgentSessionTerminalRecord | undefined => registry.terminal(id),
    inspect: (id: string): AgentSessionSnapshot | undefined => registry.inspect(id),
    list: (filter?: AgentSessionFilter) => registry.list(filter),
    listAgents: () => catalog.list(),
    listTerminal: (filter?: AgentSessionTerminalFilter) => registry.listTerminal(filter),
    open: (input: OpenAgentSession, context?: AgentSessionLaunchContext): Promise<AgentSession> =>
      start(openings.fresh(input, context), context?.signal),
    respond: async (
      id: string,
      input: RespondAgentSessionRequest,
    ): Promise<RespondAgentSessionResult> => {
      const handle = registry.get(id);
      if (handle === undefined)
        throw sessionManagerError(
          'revo.agent.session_unknown',
          'The session is unknown.',
          'session_running',
        );
      return handle.respond(input);
    },
    resume: (
      input: ResumeAgentSession,
      context?: AgentSessionLaunchContext,
    ): Promise<AgentSession> => start(openings.resume(input, context), context?.signal),
  });

  return Object.freeze({
    initialize: (snapshots: unknown) => {
      if (options.activeStateSink === undefined || options.recoveryInspector === undefined) {
        if (Array.isArray(snapshots) && snapshots.length === 0) return Promise.resolve();
        return Promise.reject(
          sessionManagerError(
            'revo.agent.session_state_unavailable',
            'Session recovery is unavailable.',
            'session_recovery',
          ),
        );
      }
      const limits = resolveAgentSessionManagerLimits(options.limits);
      const recovery = beginAgentSessionRecovery({
        agents: options.agents,
        inspector: options.recoveryInspector,
        operationTimeoutMs: limits.activeStateOperationTimeoutMs,
        recoveryTimeoutMs: limits.recoveryTimeoutMs,
        sink: options.activeStateSink,
        snapshots,
      });
      initializationQuiescence = recovery.quiescence;
      return recovery.result;
    },
    sessions,
    shutdown: (reason?: string): Promise<void> => {
      if (shutdown !== undefined) return shutdown;
      accepting = false;
      const entries = registry.activeEntries();
      shutdown = Promise.all(entries.map((entry) => cancelRuntime(entry, reason)))
        .then(() => Promise.all(entries.map(({ runtime }) => runtime.whenQuiescent())))
        .then(() => {
          registry.reconcileAll();
          if (registry.activeEntries().length > 0)
            throw sessionManagerError(
              'revo.agent.shutdown_failed',
              'Session shutdown could not confirm cleanup.',
              'shutdown',
            );
        });
      return shutdown;
    },
    whenInitializationQuiescent: () => initializationQuiescence,
  });
};

export const createManagedAgentSessions = (options: ManagedAgentSessionsOptions): AgentSessions =>
  createManagedAgentSessionController(options).sessions;
