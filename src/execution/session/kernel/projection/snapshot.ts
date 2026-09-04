import type {
  AgentSessionPendingInteraction,
  AgentSessionSnapshot,
} from '../../../../contracts/session/lifecycle/snapshot.js';
import type { InteractionState } from '../model/interaction-state.js';
import type { SessionState } from '../model/session-state.js';

const pendingInteraction = (interaction: InteractionState): AgentSessionPendingInteraction => ({
  request: interaction.request,
  scope: interaction.scope,
  state: interaction.stage,
});

export const projectSessionSnapshot = (state: SessionState): AgentSessionSnapshot | undefined => {
  if (
    state.status === 'closed' ||
    state.status === 'cancelled' ||
    state.status === 'failed' ||
    state.status === 'timed_out' ||
    state.status === 'hibernated'
  )
    return undefined;
  const active =
    state.status === 'idle' ||
    state.status === 'running' ||
    state.status === 'checkpointing' ||
    state.status === 'hibernating' ||
    state.status === 'closing' ||
    state.status === 'cancelling';
  let activeTurnId: string | undefined;
  if (state.status === 'running') activeTurnId = state.turn.turnId;
  else if (
    (state.status === 'closing' || state.status === 'cancelling') &&
    state.progress.stage === 'settling_turn'
  )
    activeTurnId = state.progress.turn.turnId;
  return {
    acceptedAt: state.acceptedAt,
    ...(activeTurnId === undefined ? {} : { activeTurnId }),
    ...(active ? { capabilities: state.capabilities, openedAt: state.openedAt } : {}),
    ...(state.events.cursor === undefined ? {} : { cursor: state.events.cursor }),
    ...(state.metadata === undefined ? {} : { metadata: state.metadata }),
    outputDirectory: state.outputDirectory,
    pendingInteractions: state.interactions.map(pendingInteraction),
    pin: state.pin,
    sessionId: state.sessionId,
    status: state.status,
  };
};
