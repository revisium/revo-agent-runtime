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

  it('fails closed when the redacted message exceeds its total budget', () => {
    const stream = new SessionMessageStream({
      digest,
      maxChunkBytes: 8,
      maxMessageBytes: 4,
      secrets: [],
    });

    expect(() => stream.push('hello')).toThrow(SessionMessageLimitError);
  });
});
