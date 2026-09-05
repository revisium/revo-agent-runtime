import type { PublicSessionCommand } from '../../command/public.js';
import type { SessionState } from '../../model/session-state.js';

export type OpeningState = Extract<SessionState, { readonly status: 'opening' }>;
export const openingCleanupInProgress = (state: OpeningState): boolean =>
  state.progress.stage === 'cleaning_process' || state.progress.stage === 'removing_state';
export type OpeningCommand = Extract<
  PublicSessionCommand,
  { readonly type: 'session.open' | 'session.resume' }
>;

export const createOpeningSessionState = (command: OpeningCommand): OpeningState => {
  const opening = command.opening;
  const request = opening.request.request;
  const previousCursor =
    opening.request.kind === 'resume' ? opening.request.request.token.cursor : undefined;
  const streamId = previousCursor?.streamId ?? opening.streamId;
  return {
    ...(opening.acceptedTurnIds === undefined ? {} : { acceptedTurnIds: opening.acceptedTurnIds }),
    acceptedAt: opening.acceptedAt,
    acceptedAtMs: opening.acceptedAtMs,
    callId: command.call.callId,
    epoch: command.call.epoch,
    events: { ...(previousCursor === undefined ? {} : { cursor: previousCursor }), pending: [] },
    incarnationId: opening.incarnationId,
    idleTimerGeneration: 0,
    interactions: [],
    limits: opening.limits,
    ...(opening.metadata === undefined ? {} : { metadata: opening.metadata }),
    nextEffectSequence: 1,
    nextEventSequence: (previousCursor?.sequence ?? 0) + 1,
    outputDirectory: request.output.directory,
    pin: opening.pin,
    progress: { opening, stage: 'publishing_accepted' },
    sessionId: command.call.sessionId,
    status: 'opening',
    streamId,
    timers: [],
    usage: opening.usageBaseline,
  };
};
