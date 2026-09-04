import type { AgentFault } from '../../../../../../contracts/manager/core.js';
import type { SessionState } from '../../../model/session-state.js';

export type IdleState = Extract<SessionState, { readonly status: 'idle' }>;
export type HibernatingState = Extract<SessionState, { readonly status: 'hibernating' }>;

export const idleFromHibernation = (state: HibernatingState): IdleState => {
  const {
    callId: _callId,
    progress: _progress,
    reason: _reason,
    resumeTokenId: _resumeTokenId,
    status: _status,
    ...active
  } = state;
  return { ...active, status: 'idle' };
};

const terminalBase = (state: HibernatingState) => {
  const idle = idleFromHibernation(state);
  const {
    capabilities: _capabilities,
    lastTurn: _lastTurn,
    process: _process,
    processResourceId: _processResourceId,
    providerResourceId: _providerResourceId,
    status: _status,
    ...base
  } = idle;
  return base;
};

export const failedHibernation = (
  state: HibernatingState,
  fault: AgentFault,
  finishedAt: string,
  output?: Extract<HibernatingState['progress'], { readonly stage: 'publishing' }>['output'],
): Extract<SessionState, { readonly status: 'failed' }> => ({
  ...terminalBase(state),
  error: fault,
  finishedAt,
  ...(output === undefined ? {} : { output }),
  status: 'failed',
});

export const uncertainHibernation = (
  state: HibernatingState,
  fault: AgentFault,
  retainProcess: boolean,
): Extract<SessionState, { readonly status: 'cleanup_uncertain' }> => {
  const idle = idleFromHibernation(state);
  const {
    capabilities: _capabilities,
    lastTurn: _lastTurn,
    openedAt: _openedAt,
    process,
    processResourceId,
    providerResourceId: _providerResourceId,
    status: _status,
    ...base
  } = idle;
  return {
    ...base,
    error: fault,
    ...(retainProcess ? { process, processResourceId } : {}),
    status: 'cleanup_uncertain',
  };
};

export const completedHibernation = (
  state: HibernatingState,
  progress: Extract<HibernatingState['progress'], { readonly stage: 'publishing' }>,
): Extract<SessionState, { readonly status: 'hibernated' }> => {
  return {
    ...terminalBase(state),
    finishedAt: progress.finishedAt,
    output: progress.output,
    resumeToken: progress.resumeToken,
    status: 'hibernated',
  };
};
