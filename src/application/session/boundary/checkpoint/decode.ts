import type { JsonObject } from '../../../../contracts/agent-definition.js';
import { AgentManagerError, type AgentExecutionPin } from '../../../../contracts/manager/core.js';
import type {
  AgentSessionEventAppendPrecondition,
  AgentSessionResumeToken,
  AgentSessionUsage,
} from '../../../../contracts/session.js';
import type { AgentSessionContinuationEnvelope } from '../../../../contracts/session/continuation/envelope.js';
import { canonicalizeJsonBytes, isJsonObject } from '../../../../definition/canonical-json.js';
import type { Sha256Digest } from '../../../../execution/security/digest/port.js';
import { decodeImmutableJsonObject } from '../input/immutable-json.js';
import { continuationDigest } from './digest.js';

export interface DecodedResumeToken {
  readonly token: AgentSessionResumeToken;
  readonly envelope: AgentSessionContinuationEnvelope;
}

const textDecoder = new TextDecoder('utf-8', { fatal: true });
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const invalidToken = (
  code:
    | 'revo.agent.resume_token_invalid'
    | 'revo.agent.continuation_pin_mismatch' = 'revo.agent.resume_token_invalid',
): never => {
  throw new AgentManagerError(
    Object.freeze({
      code,
      message: 'Agent session resume token is invalid.',
      phase: 'session_opening',
      retryable: false,
    }),
  );
};

const exactKeys = (
  value: Readonly<JsonObject>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean => {
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  return (
    required.every((key) => Object.hasOwn(value, key)) && keys.every((key) => allowed.has(key))
  );
};

const encodeBase64Url = (bytes: Uint8Array): string => {
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]!;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    output += alphabet[first >> 2];
    output += alphabet[((first & 3) << 4) | ((second ?? 0) >> 4)];
    if (second !== undefined) output += alphabet[((second & 15) << 2) | ((third ?? 0) >> 6)];
    if (third !== undefined) output += alphabet[third & 63];
  }
  return output;
};

const decodeBase64Url = (value: string): Uint8Array => {
  if (value.length === 0 || !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1)
    return invalidToken();
  const output: number[] = [];
  for (let index = 0; index < value.length; index += 4) {
    const chunk = value.slice(index, index + 4);
    const first = alphabet.indexOf(chunk[0]!);
    const second = alphabet.indexOf(chunk[1]!);
    output.push((first << 2) | (second >> 4));
    const thirdCharacter = chunk[2];
    if (thirdCharacter === undefined) continue;
    const third = alphabet.indexOf(thirdCharacter);
    output.push(((second & 15) << 4) | (third >> 2));
    const fourthCharacter = chunk[3];
    if (fourthCharacter === undefined) continue;
    const fourth = alphabet.indexOf(fourthCharacter);
    output.push(((third & 3) << 6) | fourth);
  }
  return Uint8Array.from(output);
};

export const encodeContinuationPayload = (value: unknown): string =>
  encodeBase64Url(canonicalizeJsonBytes(value));

const boundedString = (value: unknown, maximum = 256): string => {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    new TextEncoder().encode(value).byteLength > maximum
  )
    return invalidToken();
  return value;
};

const decodePin = (value: unknown): AgentExecutionPin => {
  if (!isJsonObject(value) || !exactKeys(value, ['agentId', 'agentVersion', 'definitionDigest']))
    return invalidToken();
  return Object.freeze({
    agentId: boundedString(value.agentId),
    agentVersion: boundedString(value.agentVersion),
    definitionDigest: boundedString(value.definitionDigest),
  });
};

export const inspectResumeTokenPin = (value: Readonly<JsonObject>): AgentExecutionPin =>
  decodePin(value.pin);

const decodeCursor = (value: unknown) => {
  if (!isJsonObject(value) || !exactKeys(value, ['eventId', 'sequence', 'streamId']))
    return invalidToken();
  if (!Number.isSafeInteger(value.sequence) || Number(value.sequence) < 1) return invalidToken();
  return Object.freeze({
    eventId: boundedString(value.eventId),
    sequence: Number(value.sequence),
    streamId: boundedString(value.streamId),
  });
};

const decodeUsage = (value: unknown): AgentSessionUsage => {
  if (
    !isJsonObject(value) ||
    !exactKeys(value, ['scope'], ['inputTokens', 'outputTokens', 'totalTokens']) ||
    value.scope !== 'session_cumulative'
  )
    return invalidToken();
  const tokens = (name: 'inputTokens' | 'outputTokens' | 'totalTokens'): number | undefined => {
    const candidate = value[name];
    if (candidate === undefined) return undefined;
    if (!Number.isSafeInteger(candidate) || Number(candidate) < 0) return invalidToken();
    return Number(candidate);
  };
  const inputTokens = tokens('inputTokens');
  const outputTokens = tokens('outputTokens');
  const totalTokens = tokens('totalTokens');
  return Object.freeze({
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    scope: 'session_cumulative',
    ...(totalTokens === undefined ? {} : { totalTokens }),
  });
};

const decodeEnvelope = (
  payload: string,
  maximumBytes: number,
): AgentSessionContinuationEnvelope => {
  try {
    const bytes = decodeBase64Url(payload);
    if (encodeBase64Url(bytes) !== payload) return invalidToken();
    const parsed: unknown = JSON.parse(textDecoder.decode(bytes));
    const value = decodeImmutableJsonObject(parsed, {
      maxBytes: maximumBytes,
      maxDepth: 32,
      maxNodes: 14_096,
    });
    if (
      !exactKeys(value, ['provider', 'schemaVersion', 'usageBaseline'], ['acceptedTurnIds']) ||
      value.schemaVersion !== 'agent-session-continuation-envelope/v1'
    )
      return invalidToken();
    if (
      !isJsonObject(value.provider) ||
      !exactKeys(value.provider, ['data', 'format']) ||
      !isJsonObject(value.provider.data)
    )
      return invalidToken();
    const accepted = value.acceptedTurnIds;
    if (
      accepted !== undefined &&
      (!Array.isArray(accepted) ||
        accepted.length > 10_000 ||
        accepted.some(
          (id) =>
            typeof id !== 'string' ||
            id.length === 0 ||
            new TextEncoder().encode(id).byteLength > 256,
        ) ||
        new Set(accepted).size !== accepted.length)
    )
      return invalidToken();
    const acceptedTurnIds =
      accepted === undefined ? undefined : Object.freeze(accepted.map((id) => boundedString(id)));
    return Object.freeze({
      ...(acceptedTurnIds === undefined ? {} : { acceptedTurnIds }),
      provider: Object.freeze({
        data: decodeImmutableJsonObject(value.provider.data, {
          maxBytes: maximumBytes,
          maxDepth: 32,
          maxNodes: 4_096,
        }),
        format: boundedString(value.provider.format, 256),
      }),
      schemaVersion: 'agent-session-continuation-envelope/v1',
      usageBaseline: decodeUsage(value.usageBaseline),
    });
  } catch (error: unknown) {
    if (error instanceof AgentManagerError) throw error;
    return invalidToken();
  }
};

const samePin = (left: AgentExecutionPin, right: AgentExecutionPin): boolean =>
  left.agentId === right.agentId &&
  left.agentVersion === right.agentVersion &&
  left.definitionDigest === right.definitionDigest;

export const decodeResumeToken = (
  input: unknown,
  expectedPin: AgentExecutionPin,
  digest: Sha256Digest,
  maximumBytes: number,
): DecodedResumeToken => {
  try {
    const value = decodeImmutableJsonObject(input, {
      maxBytes: maximumBytes,
      maxDepth: 8,
      maxNodes: 64,
    });
    if (
      !exactKeys(value, [
        'cursor',
        'eligibility',
        'payload',
        'pin',
        'resumeTokenId',
        'schemaVersion',
        'sessionId',
        'sha256',
      ])
    )
      return invalidToken();
    if (
      value.schemaVersion !== 'agent-session-resume-token/v1' ||
      value.eligibility !== 'hibernated'
    )
      return invalidToken();
    const tokenWithoutDigest = Object.freeze({
      cursor: decodeCursor(value.cursor),
      eligibility: 'hibernated' as const,
      payload: boundedString(value.payload, maximumBytes),
      pin: decodePin(value.pin),
      resumeTokenId: boundedString(value.resumeTokenId),
      schemaVersion: 'agent-session-resume-token/v1' as const,
      sessionId: boundedString(value.sessionId),
    });
    const sha256 = boundedString(value.sha256, 64);
    if (continuationDigest(tokenWithoutDigest, digest) !== sha256) return invalidToken();
    if (!samePin(tokenWithoutDigest.pin, expectedPin))
      return invalidToken('revo.agent.continuation_pin_mismatch');
    const token = Object.freeze({ ...tokenWithoutDigest, sha256 });
    return Object.freeze({ envelope: decodeEnvelope(token.payload, maximumBytes), token });
  } catch (error: unknown) {
    if (error instanceof AgentManagerError) throw error;
    return invalidToken();
  }
};

export const resumePredecessor = (
  token: AgentSessionResumeToken,
): AgentSessionEventAppendPrecondition =>
  Object.freeze({
    cursor: token.cursor,
    kind: 'hibernation_token',
    resumeTokenId: token.resumeTokenId,
    resumeTokenSha256: token.sha256,
  });
