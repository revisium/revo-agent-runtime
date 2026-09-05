import { AgentManagerError } from '../../../contracts/manager.js';
import type {
  AgentSession,
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

export const createManagedAgentSessions = (options: ManagedAgentSessionsOptions): AgentSessions => {
  const catalog = new SessionAgentCatalog(options.agents);
  const registry = new ManagedSessionRegistry(resolveAgentSessionManagerLimits(options.limits));
  const openings = new ManagedSessionOpeningBuilder(options, catalog, registry);

  const start = async (opening: PreparedManagedSessionOpening): Promise<AgentSession> => {
    const command = opening.command;
    const runtime = options.runtimeFactory.createOpening(command);
    registry.register(command.call.sessionId, opening.epoch, runtime);
    await requireReady(runtime, opening);
    const handle = createManagedSessionHandle(options, registry, runtime, opening);
    registry.attach(command.call.sessionId, handle);
    return handle;
  };

  return Object.freeze({
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
    open: (input: OpenAgentSession): Promise<AgentSession> => start(openings.fresh(input)),
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
    resume: (input: ResumeAgentSession): Promise<AgentSession> => start(openings.resume(input)),
  });
};
