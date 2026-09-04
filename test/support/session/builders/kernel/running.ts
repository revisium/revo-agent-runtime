import type { SessionState } from '../../../../../src/execution/session/kernel/model/session-state.js';
import { idleSessionState } from './session-state.js';

type RunningState = Extract<SessionState, { readonly status: 'running' }>;
export type StreamingSessionState = RunningState & {
  readonly turn: Extract<RunningState['turn'], { readonly status: 'streaming' }>;
};

export const streamingSessionState = (): StreamingSessionState => ({
  ...idleSessionState(),
  status: 'running',
  turn: {
    correlation: {
      effectId: 'session_01:1:effect:9',
      epoch: 1,
      sessionId: 'session_01',
      turnId: 'turn_01',
    },
    handleCallId: 'send_01',
    message: { content: '', role: 'assistant' },
    prompt: 'Continue',
    resultCallId: 'result_01',
    status: 'streaming',
    turnId: 'turn_01',
    usage: { scope: 'session_cumulative' },
  },
});
