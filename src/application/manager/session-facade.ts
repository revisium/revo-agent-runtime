import type { AgentSessions } from '../../contracts/session/api/manager.js';

interface SessionFacadeAccess {
  readonly requireOpen: () => void;
  readonly requireReady: () => void;
}

export const createManagerSessionFacade = (
  sessions: AgentSessions,
  access: SessionFacadeAccess,
): AgentSessions => {
  const facade: AgentSessions = {
    cancel: async (sessionId, reason) => {
      access.requireOpen();
      return sessions.cancel(sessionId, reason);
    },
    get: (sessionId) => {
      access.requireReady();
      return sessions.get(sessionId);
    },
    getTerminal: (sessionId) => {
      access.requireReady();
      return sessions.getTerminal(sessionId);
    },
    inspect: (sessionId) => {
      access.requireReady();
      return sessions.inspect(sessionId);
    },
    list: (filter) => {
      access.requireReady();
      return sessions.list(filter);
    },
    listAgents: () => sessions.listAgents(),
    listTerminal: (filter) => {
      access.requireReady();
      return sessions.listTerminal(filter);
    },
    open: async (request, context) => {
      access.requireOpen();
      return sessions.open(request, context);
    },
    respond: async (sessionId, input) => {
      access.requireOpen();
      return sessions.respond(sessionId, input);
    },
    resume: async (request, context) => {
      access.requireOpen();
      return sessions.resume(request, context);
    },
  };
  return Object.freeze(facade);
};
