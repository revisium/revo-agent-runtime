import type { SessionState } from '../../model/session-state.js';

export type IdleState = Extract<SessionState, { readonly status: 'idle' }>;
export type CheckpointingState = Extract<SessionState, { readonly status: 'checkpointing' }>;

export const idleFromCheckpoint = (state: CheckpointingState): IdleState => {
  const {
    callId: _callId,
    checkpointId: _checkpointId,
    progress: _progress,
    status: _status,
    terminalAfterCheckpoint: _terminalAfterCheckpoint,
    ...active
  } = state;
  return { ...active, status: 'idle' };
};
