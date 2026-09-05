import type { Sha256Digest } from '../../../security/digest/port.js';
import { createRedactionChannel } from '../../../security/redaction/channel.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export class SessionMessageLimitError extends Error {
  constructor() {
    super('Provider message exceeds its configured byte limit.');
    this.name = 'SessionMessageLimitError';
  }
}

interface SessionMessageStreamOptions {
  readonly digest: Sha256Digest;
  readonly maxChunkBytes: number;
  readonly maxMessageBytes: number;
  readonly secrets: readonly string[];
}

interface SessionMessageCompletion {
  readonly chunks: readonly string[];
  readonly summary: { readonly contentBytes: number; readonly contentSha256: string };
}

const concatenate = (parts: readonly Uint8Array[]): Uint8Array => {
  const output = new Uint8Array(parts.reduce((length, part) => length + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
};

const utf8Chunks = (bytes: Uint8Array, maximum: number): readonly string[] => {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.byteLength;) {
    let end = Math.min(offset + maximum, bytes.byteLength);
    while (end < bytes.byteLength && end > offset && (bytes[end]! & 0xc0) === 0x80) end -= 1;
    if (end === offset) throw new SessionMessageLimitError();
    chunks.push(decoder.decode(bytes.subarray(offset, end)));
    offset = end;
  }
  return chunks;
};

export class SessionMessageStream {
  readonly #redaction;
  readonly #parts: Uint8Array[] = [];
  readonly #options: SessionMessageStreamOptions;
  #bytes = 0;
  #completion: SessionMessageCompletion | undefined;

  constructor(options: SessionMessageStreamOptions) {
    if (
      !Number.isSafeInteger(options.maxChunkBytes) ||
      options.maxChunkBytes < 4 ||
      !Number.isSafeInteger(options.maxMessageBytes) ||
      options.maxMessageBytes < 1
    )
      throw new SessionMessageLimitError();
    this.#options = options;
    this.#redaction = createRedactionChannel(options.secrets);
  }

  push(content: string): readonly string[] {
    if (this.#completion !== undefined) throw new SessionMessageLimitError();
    return this.#accept(this.#redaction.feed(encoder.encode(content)));
  }

  complete(): SessionMessageCompletion {
    if (this.#completion !== undefined) return this.#completion;
    const chunks = this.#accept(this.#redaction.flush());
    this.#redaction.dispose();
    const content = concatenate(this.#parts);
    this.#completion = Object.freeze({
      chunks,
      summary: Object.freeze({
        contentBytes: content.byteLength,
        contentSha256: this.#options.digest.digest(content),
      }),
    });
    return this.#completion;
  }

  #accept(bytes: Uint8Array): readonly string[] {
    if (this.#bytes + bytes.byteLength > this.#options.maxMessageBytes) {
      this.#redaction.dispose();
      throw new SessionMessageLimitError();
    }
    if (bytes.byteLength === 0) return [];
    const owned = bytes.slice();
    this.#parts.push(owned);
    this.#bytes += owned.byteLength;
    return Object.freeze(utf8Chunks(owned, this.#options.maxChunkBytes));
  }
}
