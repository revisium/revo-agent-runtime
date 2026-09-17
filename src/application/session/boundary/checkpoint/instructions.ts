import type { JsonObject } from '../../../../contracts/agent-definition.js';
import { AgentManagerError } from '../../../../contracts/manager/core.js';
import {
  instructionsMatchContinuation,
  readInstructionsContinuation,
} from '../../../../execution/instructions/continuation.js';
import type { Sha256Digest } from '../../../../execution/security/digest/port.js';

const encoder = new TextEncoder();

/** Resume must resupply exactly the checkpointed instructions; the check never consumes a token. */
export const requireMatchingInstructions = (
  continuation: Readonly<JsonObject>,
  instructions: string | undefined,
  digest: Sha256Digest,
): void => {
  const current =
    instructions === undefined ? undefined : digest.digest(encoder.encode(instructions));
  if (instructionsMatchContinuation(readInstructionsContinuation(continuation), current)) return;
  throw new AgentManagerError(
    Object.freeze({
      code: 'revo.agent.checkpoint_invalid',
      message: 'Resumed instructions do not match the checkpoint.',
      phase: 'session_opening',
      retryable: false,
    }),
  );
};
