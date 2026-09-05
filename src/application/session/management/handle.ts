import type { AgentSession } from '../../../contracts/session.js';
import type { SessionCommandRuntime } from '../../../execution/session/runtime/actor/port.js';
import { decodeRespondAgentSessionRequest } from '../boundary/input/response.js';
import { decodeSendAgentSessionInput } from '../boundary/input/send.js';
import { createAgentSessionHandle } from '../handles/session.js';
import { interactionRequestId, turnId } from '../policy/identity/identifiers.js';
import { sessionManagerError } from './errors.js';
import type { PreparedManagedSessionOpening } from './opening.js';
import type { ManagedAgentSessionsOptions } from './options.js';
import type { ManagedSessionRegistry } from './registry.js';

export const createManagedSessionHandle = (
  options: ManagedAgentSessionsOptions,
  registry: ManagedSessionRegistry,
  runtime: SessionCommandRuntime,
  opening: PreparedManagedSessionOpening,
): AgentSession => {
  const { limits, epoch, pin } = opening;
  const snapshot = runtime.inspect();
  if (snapshot?.capabilities === undefined)
    throw sessionManagerError(
      'revo.agent.internal',
      'Session opening did not expose capabilities.',
    );
  return createAgentSessionHandle({
    capabilities: snapshot.capabilities,
    clock: options.clock,
    decodeResponse: (value) => {
      const decoded = decodeRespondAgentSessionRequest(value, limits);
      interactionRequestId(decoded.requestId);
      return decoded;
    },
    decodeSend: (value) => {
      const decoded = decodeSendAgentSessionInput(value, limits);
      turnId(decoded.turnId);
      return decoded;
    },
    epoch,
    nextIdentity: options.nextIdentity,
    onSettled: () => registry.reconcile(snapshot.sessionId),
    pin,
    runtime,
    sessionId: snapshot.sessionId,
  });
};
