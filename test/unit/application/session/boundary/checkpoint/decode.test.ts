import { createHash } from 'node:crypto';

import { describe, expect, test } from 'vitest';

import {
  decodeResumeToken,
  encodeContinuationPayload,
  resumePredecessor,
} from '../../../../../../src/application/session/boundary/checkpoint/decode.js';
import { continuationDigest } from '../../../../../../src/application/session/boundary/checkpoint/digest.js';
import type { AgentExecutionPin } from '../../../../../../src/contracts/manager.js';
import { AgentManagerError } from '../../../../../../src/contracts/manager.js';
import type { AgentSessionContinuationEnvelope } from '../../../../../../src/contracts/session/continuation/envelope.js';
import type { Sha256Digest } from '../../../../../../src/execution/security/digest/port.js';

const digest: Sha256Digest = {
  digest: (bytes) => createHash('sha256').update(bytes).digest('hex'),
};
const pin = {
  agentId: 'codex-acp',
  agentVersion: '1.7.0',
  definitionDigest: 'definition-digest',
} satisfies AgentExecutionPin;
const envelope = {
  provider: { data: { sessionId: 'native-session' }, format: 'acp/v1' },
  schemaVersion: 'agent-session-continuation-envelope/v1',
  usageBaseline: { inputTokens: 1, outputTokens: 2, scope: 'session_cumulative', totalTokens: 3 },
} satisfies AgentSessionContinuationEnvelope;

const tokenWithoutDigest = () => ({
  cursor: { eventId: 'evt_10', sequence: 10, streamId: 'stream_01' },
  eligibility: 'hibernated' as const,
  payload: encodeContinuationPayload(envelope),
  pin,
  resumeTokenId: 'tok_01',
  schemaVersion: 'agent-session-resume-token/v1' as const,
  sessionId: 'dlg_01',
});

const token = () => {
  const value = tokenWithoutDigest();
  return { ...value, sha256: continuationDigest(value, digest) };
};

const signedWithPayload = (payload: string) => {
  const value = { ...tokenWithoutDigest(), payload };
  return { ...value, sha256: continuationDigest(value, digest) };
};

describe('resume token boundary', () => {
  test.each([
    null,
    'turn',
    ['same', 'same'],
    [''],
    [7],
    ['x'.repeat(257)],
    Array.from({ length: 10_001 }, (_, index) => `turn-${index}`),
  ])('rejects an invalid accepted-turn ledger %#', (acceptedTurnIds) => {
    const payload = encodeContinuationPayload({ ...envelope, acceptedTurnIds });
    expect(() => decodeResumeToken(signedWithPayload(payload), pin, digest, 1_048_576)).toThrow(
      AgentManagerError,
    );
  });

  test('owns the accepted-turn ledger without increasing the provider payload node allowance', () => {
    const payload = encodeContinuationPayload({ ...envelope, acceptedTurnIds: ['turn-1'] });
    const decoded = decodeResumeToken(signedWithPayload(payload), pin, digest, 1_048_576);
    expect(decoded.envelope.acceptedTurnIds).toEqual(['turn-1']);
    expect(Object.isFrozen(decoded.envelope.acceptedTurnIds)).toBe(true);
    const oversized = encodeContinuationPayload({
      ...envelope,
      provider: { format: 'acp/v1', data: { items: Array.from({ length: 4_097 }, () => 0) } },
    });
    expect(() => decodeResumeToken(signedWithPayload(oversized), pin, digest, 1_048_576)).toThrow(
      AgentManagerError,
    );
  });

  test('verifies, owns, freezes, and derives the full journal predecessor', () => {
    const input = token();
    const decoded = decodeResumeToken(input, pin, digest, 1_048_576);
    input.cursor.sequence = 99;

    expect(decoded.token.cursor.sequence).toBe(10);
    expect(decoded.token.sha256).toBe(
      'e7eb2b89aef2640522cb175f87b95c8b33fce329706c8dd8f4ade22d367effcf',
    );
    expect(decoded.envelope).toEqual(envelope);
    expect(Object.isFrozen(decoded.envelope.provider.data)).toBe(true);
    expect(resumePredecessor(decoded.token)).toEqual({
      cursor: decoded.token.cursor,
      kind: 'hibernation_token',
      resumeTokenId: 'tok_01',
      resumeTokenSha256: decoded.token.sha256,
    });
  });

  test.each([
    () => ({ ...token(), sha256: 'modified' }),
    () => ({ ...token(), eligibility: 'observation_only' }),
    () => ({ ...token(), schemaVersion: 'agent-session-checkpoint/v1' }),
    () => ({ ...token(), extra: true }),
    () => ({ ...token(), cursor: { eventId: 'evt_10', sequence: 0, streamId: 'stream_01' } }),
    () => ({ ...token(), cursor: null }),
    () => ({ ...token(), pin: null }),
    () => ({ ...token(), resumeTokenId: '' }),
    () => ({ ...token(), sessionId: '' }),
  ])('rejects malformed, modified, or relabelled tokens', (input) => {
    expect(() => decodeResumeToken(input(), pin, digest, 1_048_576)).toThrow(AgentManagerError);
  });

  test('rejects a token pinned to another immutable definition', () => {
    expect(() =>
      decodeResumeToken(token(), { ...pin, definitionDigest: 'other' }, digest, 1_048_576),
    ).toThrow(AgentManagerError);
  });

  test('rejects an invalid or oversized exact envelope', () => {
    const invalidEnvelope = { ...envelope, extra: true };
    const value = { ...tokenWithoutDigest(), payload: encodeContinuationPayload(invalidEnvelope) };
    const signed = { ...value, sha256: continuationDigest(value, digest) };

    expect(() => decodeResumeToken(signed, pin, digest, 1_048_576)).toThrow(AgentManagerError);
    expect(() => decodeResumeToken(token(), pin, digest, 10)).toThrow(AgentManagerError);
  });

  test('accepts an exact minimal usage baseline', () => {
    const minimal = {
      ...envelope,
      provider: { data: {}, format: 'native/v1' },
      usageBaseline: { scope: 'session_cumulative' },
    };
    expect(
      decodeResumeToken(
        signedWithPayload(encodeContinuationPayload(minimal)),
        pin,
        digest,
        1_048_576,
      ).envelope,
    ).toEqual(minimal);
  });

  test.each([
    '',
    'a',
    'ab',
    'not+base64',
    encodeContinuationPayload('not an object'),
    encodeContinuationPayload({ ...envelope, schemaVersion: 'other' }),
    encodeContinuationPayload({ ...envelope, provider: null }),
    encodeContinuationPayload({ ...envelope, provider: { data: [], format: 'acp/v1' } }),
    encodeContinuationPayload({ ...envelope, provider: { data: {}, format: '' } }),
    encodeContinuationPayload({ ...envelope, usageBaseline: { scope: 'turn' } }),
    encodeContinuationPayload({
      ...envelope,
      usageBaseline: { inputTokens: -1, scope: 'session_cumulative' },
    }),
  ])('rejects invalid encoded continuation payload %#', (payload) => {
    expect(() => decodeResumeToken(signedWithPayload(payload), pin, digest, 1_048_576)).toThrow(
      AgentManagerError,
    );
  });
});
