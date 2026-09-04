import { AgentManagerError } from '../../../../contracts/manager.js';

const encoder = new TextEncoder();
const maximumIdentifierBytes = 256;

const invalidIdentifier = (): never => {
  throw new AgentManagerError(
    Object.freeze({
      code: 'revo.agent.interaction_invalid',
      message: 'Session identifier is invalid.',
      phase: 'session_opening',
      retryable: false,
    }),
  );
};

const hasUnpairedSurrogate = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isFinite(next) || next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return true;
  }
  return false;
};

const identifier = (value: unknown): string => {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.includes('\0') ||
    hasUnpairedSurrogate(value) ||
    encoder.encode(value).byteLength > maximumIdentifierBytes
  )
    return invalidIdentifier();
  return value;
};

export const sessionId = identifier;
export const turnId = identifier;
export const interactionRequestId = identifier;
export const continuationId = identifier;
