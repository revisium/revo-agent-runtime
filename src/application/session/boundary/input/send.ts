import { AgentManagerError } from '../../../../contracts/manager/core.js';
import type { SendAgentSessionInput } from '../../../../contracts/session.js';
import { isJsonObject } from '../../../../definition/canonical-json.js';
import {
  decodeImmutableJsonObject,
  hasExactJsonKeys,
  immutableJsonByteLength,
} from './immutable-json.js';

const encoder = new TextEncoder();
interface SendInputLimits {
  readonly maxMetadataBytes: number;
  readonly maxPromptBytes: number;
}
export interface DecodedSendAgentSessionInput extends Omit<SendAgentSessionInput, 'metadata'> {
  readonly metadata?: Readonly<import('../../../../contracts/agent-definition.js').JsonObject>;
}
const invalid = (): never => {
  throw new AgentManagerError(
    Object.freeze({
      code: 'revo.agent.parameters_invalid',
      message: 'Agent session turn input is invalid.',
      phase: 'session_running',
      retryable: false,
    }),
  );
};

export const decodeSendAgentSessionInput = (
  input: unknown,
  limits: SendInputLimits,
): DecodedSendAgentSessionInput => {
  try {
    const value = decodeImmutableJsonObject(input, {
      maxBytes: limits.maxPromptBytes + limits.maxMetadataBytes + 1_024,
      maxDepth: 32,
      maxNodes: 10_000,
    });
    if (!hasExactJsonKeys(value, ['prompt', 'turnId'], ['metadata'])) return invalid();
    if (
      typeof value.prompt !== 'string' ||
      value.prompt.length === 0 ||
      encoder.encode(value.prompt).byteLength > limits.maxPromptBytes
    )
      return invalid();
    const metadata = value.metadata;
    if (
      metadata !== undefined &&
      (!isJsonObject(metadata) || immutableJsonByteLength(metadata) > limits.maxMetadataBytes)
    )
      return invalid();
    return Object.freeze({
      ...(metadata === undefined ? {} : { metadata }),
      prompt: value.prompt,
      turnId:
        typeof value.turnId === 'string' && value.turnId.length > 0 ? value.turnId : invalid(),
    });
  } catch (error: unknown) {
    if (error instanceof AgentManagerError) throw error;
    return invalid();
  }
};
