import { AgentManagerError } from '../../../contracts/manager/core.js';
import type {
  AgentSession,
  AgentSessionCheckpoint,
  AgentSessionCommandContext,
  AgentSessionHibernateResult,
  AgentSessionTurn,
  CancelAgentSessionResult,
  CloseAgentSessionResult,
  RespondAgentSessionRequest,
  RespondAgentSessionResult,
  SendAgentSessionInput,
} from '../../../contracts/session.js';
import { dispatchCall } from './call.js';
import type { AgentSessionHandleOptions } from './context.js';
import { createAgentSessionTurn } from './turn.js';

const observedCommand = (options: AgentSessionHandleOptions) => {
  const observed = options.clock.now();
  return {
    call: {
      callId: options.nextIdentity('call'),
      epoch: options.epoch,
      sessionId: options.sessionId,
    },
    observedAt: observed.iso,
    observedAtMs: observed.milliseconds,
  } as const;
};

const requireIdle = (options: AgentSessionHandleOptions): void => {
  const snapshot = options.runtime.inspect();
  if (snapshot === undefined)
    throw new AgentManagerError({
      code: 'revo.agent.session_closed',
      message: 'The session is terminal.',
      phase: 'session_running',
      retryable: false,
    });
  if (snapshot.status !== 'idle')
    throw new AgentManagerError({
      code: 'revo.agent.session_busy',
      message: 'The session is not ready for a new turn.',
      phase: 'session_running',
      retryable: true,
    });
};

export const createAgentSessionHandle = (options: AgentSessionHandleOptions): AgentSession =>
  Object.freeze({
    cancel: async (reason?: string): Promise<CancelAgentSessionResult> => {
      const resolution = await dispatchCall(
        options.runtime,
        {
          ...observedCommand(options),
          ...(reason === undefined ? {} : { reason }),
          type: 'session.cancel',
        },
        'cancel_session',
      );
      options.onSettled();
      return resolution.result;
    },
    capabilities: options.capabilities,
    checkpoint: async (): Promise<AgentSessionCheckpoint> => {
      const resolution = await dispatchCall(
        options.runtime,
        {
          ...observedCommand(options),
          checkpointId: options.nextIdentity('checkpoint'),
          type: 'session.checkpoint',
        },
        'checkpoint',
      );
      options.onSettled();
      return resolution.checkpoint;
    },
    close: async (reason?: string): Promise<CloseAgentSessionResult> => {
      const resolution = await dispatchCall(
        options.runtime,
        {
          ...observedCommand(options),
          ...(reason === undefined ? {} : { reason }),
          type: 'session.close',
        },
        'close',
      );
      options.onSettled();
      return resolution.result;
    },
    hibernate: async (reason?: string): Promise<AgentSessionHibernateResult> => {
      const resolution = await dispatchCall(
        options.runtime,
        {
          ...observedCommand(options),
          ...(reason === undefined ? {} : { reason }),
          resumeTokenId: options.nextIdentity('resume_token'),
          type: 'session.hibernate',
        },
        'hibernate',
      );
      options.onSettled();
      return resolution.result;
    },
    pin: options.pin,
    respond: async (input: RespondAgentSessionRequest): Promise<RespondAgentSessionResult> => {
      const resolution = await dispatchCall(
        options.runtime,
        {
          ...observedCommand(options),
          input: options.decodeResponse(input),
          type: 'interaction.respond',
        },
        'interaction',
      );
      options.onSettled();
      return resolution.result;
    },
    send: async (
      input: SendAgentSessionInput,
      context?: AgentSessionCommandContext,
    ): Promise<AgentSessionTurn> => {
      if (context?.signal?.aborted)
        throw new AgentManagerError({
          code: 'revo.agent.cancelled',
          message: 'The session turn was cancelled.',
          phase: 'session_running',
          retryable: false,
        });
      requireIdle(options);
      const decoded = options.decodeSend(input);
      const resultCallId = options.nextIdentity('call');
      const resultSettlement = options.runtime.registerCall(resultCallId);
      const command = {
        ...observedCommand(options),
        call: {
          callId: options.nextIdentity('call'),
          epoch: options.epoch,
          sessionId: options.sessionId,
          turnId: decoded.turnId,
        },
        input: decoded,
        ...(decoded.metadata === undefined ? {} : { metadata: decoded.metadata }),
        resultCallId,
        type: 'turn.send' as const,
      };
      const ready = await dispatchCall(options.runtime, command, 'turn_ready');
      options.onSettled();
      const turn = createAgentSessionTurn(options, ready.turnId, resultSettlement);
      const signal = context?.signal;
      if (signal === undefined) return turn;
      const cancel = (): void => {
        void turn.cancel('The session turn was cancelled.').catch(() => undefined);
      };
      signal.addEventListener('abort', cancel, { once: true });
      const removeListener = (): void => signal.removeEventListener('abort', cancel);
      void resultSettlement.then(removeListener, removeListener);
      if (signal.aborted) cancel();
      return turn;
    },
    sessionId: options.sessionId,
  });
