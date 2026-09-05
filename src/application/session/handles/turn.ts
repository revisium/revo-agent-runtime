import type {
  AgentSessionTurn,
  AgentSessionTurnResult,
  CancelAgentSessionTurnResult,
} from '../../../contracts/session.js';
import type { PublicCallSettlement } from '../../../execution/session/runtime/actor/port.js';
import { dispatchCall, resolutionOf } from './call.js';
import type { AgentSessionHandleOptions } from './context.js';

export const createAgentSessionTurn = (
  options: AgentSessionHandleOptions,
  turnId: string,
  resultSettlement: Promise<PublicCallSettlement>,
): AgentSessionTurn => {
  const result = resultSettlement.then((settlement) => {
    options.onSettled();
    return resolutionOf(settlement, 'turn_result').result;
  });
  return Object.freeze({
    cancel: async (reason?: string): Promise<CancelAgentSessionTurnResult> => {
      const observed = options.clock.now();
      const resolution = await dispatchCall(
        options.runtime,
        {
          call: {
            callId: options.nextIdentity('call'),
            epoch: options.epoch,
            sessionId: options.sessionId,
            turnId,
          },
          observedAt: observed.iso,
          observedAtMs: observed.milliseconds,
          ...(reason === undefined ? {} : { reason }),
          turnId,
          type: 'turn.cancel',
        },
        'cancel_turn',
      );
      options.onSettled();
      return resolution.result;
    },
    result: (): Promise<AgentSessionTurnResult> => result,
    sessionId: options.sessionId,
    turnId,
  });
};
