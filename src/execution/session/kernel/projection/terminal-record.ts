import type { AgentSessionTerminalRecord } from '../../../../contracts/session/lifecycle/snapshot.js';
import type { SessionState } from '../model/session-state.js';

type TerminalState = Extract<
  SessionState,
  { readonly status: 'hibernated' | 'closed' | 'cancelled' | 'timed_out' | 'failed' }
>;

const baseRecord = (state: TerminalState) => ({
  acceptedAt: state.acceptedAt,
  cleanup: 'confirmed' as const,
  ...(state.events.cursor === undefined ? {} : { cursor: state.events.cursor }),
  finishedAt: state.finishedAt,
  ...(state.openedAt === undefined ? {} : { openedAt: state.openedAt }),
  ...(state.output === undefined ? {} : { output: state.output }),
  pin: state.pin,
  sessionId: state.sessionId,
});

export const projectTerminalRecord = (
  state: SessionState,
): AgentSessionTerminalRecord | undefined => {
  if (state.status === 'closed') return { ...baseRecord(state), status: 'closed' };
  if (state.status === 'cancelled') return { ...baseRecord(state), status: 'cancelled' };
  if (state.status === 'hibernated')
    return { ...baseRecord(state), resumeToken: state.resumeToken, status: 'hibernated' };
  if (state.status === 'failed')
    return { ...baseRecord(state), error: state.error, status: 'failed' };
  if (state.status === 'timed_out')
    return { ...baseRecord(state), error: state.error, status: 'timed_out' };
  return undefined;
};
