import { describe, expect, it } from 'vitest';

import {
  SessionMessageLimitError,
  SessionMessageStream,
} from '../../../../../../src/execution/session/interpreter/event/message-stream.js';

const decoder = new TextDecoder();
const digest = { digest: (bytes: Uint8Array) => `sha256:${decoder.decode(bytes)}` };

describe('provider message stream', () => {
  it('redacts across input boundaries and emits only UTF-8-safe chunks', () => {
    const stream = new SessionMessageStream({
      digest,
      maxChunkBytes: 8,
      maxMessageBytes: 128,
      secrets: ['secret'],
    });

    const chunks = [
      ...stream.push('😀 token=sec'),
      ...stream.push('ret done'),
      ...stream.complete().chunks,
    ];
    const result = stream.complete();

    expect(chunks.join('')).toBe('😀 token=[REDACTED] done');
    expect(chunks.every((chunk) => new TextEncoder().encode(chunk).byteLength <= 8)).toBe(true);
    expect(result.summary).toEqual({
      contentBytes: new TextEncoder().encode(chunks.join('')).byteLength,
      contentSha256: `sha256:${chunks.join('')}`,
    });
  });

  it('moves a chunk boundary before a split UTF-8 code point', () => {
    const stream = new SessionMessageStream({
      digest,
      maxChunkBytes: 4,
      maxMessageBytes: 16,
      secrets: [],
    });

    expect([...stream.push('a😀b'), ...stream.complete().chunks]).toEqual(['a', '😀', 'b']);
  });

  it('fails closed when the redacted message exceeds its total budget', () => {
    const stream = new SessionMessageStream({
      digest,
      maxChunkBytes: 8,
      maxMessageBytes: 4,
      secrets: [],
    });

    expect(() => stream.push('hello')).toThrow(SessionMessageLimitError);
  });

  it.each([
    { maxChunkBytes: 3, maxMessageBytes: 8 },
    { maxChunkBytes: Number.NaN, maxMessageBytes: 8 },
    { maxChunkBytes: 4, maxMessageBytes: 0 },
    { maxChunkBytes: 4, maxMessageBytes: Number.NaN },
  ])('rejects invalid byte limits: %o', (limits) => {
    expect(() => new SessionMessageStream({ ...limits, digest, secrets: [] })).toThrow(
      SessionMessageLimitError,
    );
  });

  it('completes an empty stream once and rejects writes after completion', () => {
    const stream = new SessionMessageStream({
      digest,
      maxChunkBytes: 4,
      maxMessageBytes: 8,
      secrets: [],
    });

    expect(stream.push('')).toEqual([]);
    const completion = stream.complete();
    expect(completion).toEqual({
      chunks: [],
      summary: { contentBytes: 0, contentSha256: 'sha256:' },
    });
    expect(stream.complete()).toBe(completion);
    expect(() => stream.push('late')).toThrow(SessionMessageLimitError);
  });
});
