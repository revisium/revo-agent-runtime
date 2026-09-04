import type { AgentFault } from '../../../../../contracts/manager/core.js';
import type { SessionState } from '../../model/session-state.js';
import { beginOpeningProcessCleanup } from '../opening/failure.js';
import { failActiveSession } from '../terminal/control.js';
import type { SessionTransition } from '../transition.js';

export type InteractionSessionState = Extract<
  SessionState,
  { readonly status: 'opening' | 'idle' | 'running' }
>;

export const failInteractionSession = (
  state: InteractionSessionState,
  fault: AgentFault,
): SessionTransition =>
  state.status === 'opening'
    ? beginOpeningProcessCleanup(state, fault, 'remove_state')
    : failActiveSession(state, fault);
