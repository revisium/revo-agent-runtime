import type { AgentDescriptor } from '../../../contracts/manager/core.js';
import type { AgentSessions } from '../../../contracts/session/api/manager.js';
import { SessionAgentCatalog } from './catalog.js';
import { sessionManagerError } from './errors.js';

const unavailable = (): never => {
  throw sessionManagerError(
    'revo.agent.session_state_unavailable',
    'Session management is not configured.',
    'manager',
  );
};

export const createUnavailableAgentSessions = (
  agents: readonly AgentDescriptor[],
): AgentSessions => {
  const catalog = new SessionAgentCatalog(agents);
  return Object.freeze({
    cancel: async () => unavailable(),
    get: () => undefined,
    getTerminal: () => undefined,
    inspect: () => undefined,
    list: () => Object.freeze([]),
    listAgents: () => catalog.list(),
    listTerminal: () => Object.freeze([]),
    open: async () => unavailable(),
    respond: async () => unavailable(),
    resume: async () => unavailable(),
  });
};
