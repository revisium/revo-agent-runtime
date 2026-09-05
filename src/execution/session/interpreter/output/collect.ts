import {
  createRedactionChannel,
  type RedactionChannel,
} from '../../../security/redaction/channel.js';

const truncationMarker = new TextEncoder().encode('\n[output truncated]\n');

interface CollectedSessionOutput {
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
  readonly truncated: { readonly stdout: boolean; readonly stderr: boolean };
}

interface OutputChannel {
  readonly redaction: RedactionChannel;
  readonly parts: Uint8Array[];
  truncated: boolean;
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

export class SessionOutputCollector {
  readonly #stdout: OutputChannel;
  readonly #stderr: OutputChannel;
  readonly #retainedLimit: number;
  #retainedBytes = 0;
  #result: CollectedSessionOutput | undefined;
  #disposed = false;

  constructor(maxBytes: number, secrets: readonly string[]) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < truncationMarker.byteLength * 2 + 1)
      throw new TypeError('Session output byte limit is too small.');
    this.#retainedLimit = maxBytes - truncationMarker.byteLength * 2;
    this.#stdout = { parts: [], redaction: createRedactionChannel(secrets), truncated: false };
    this.#stderr = { parts: [], redaction: createRedactionChannel(secrets), truncated: false };
  }

  writeStdout(bytes: Uint8Array): void {
    this.#write(this.#stdout, bytes);
  }

  writeStderr(bytes: Uint8Array): void {
    this.#write(this.#stderr, bytes);
  }

  dispose(): void {
    this.#disposed = true;
    this.#stdout.redaction.dispose();
    this.#stderr.redaction.dispose();
    this.#stdout.parts.length = 0;
    this.#stderr.parts.length = 0;
    this.#result = undefined;
  }

  finalize(): CollectedSessionOutput {
    if (this.#disposed) throw new Error('Session output has been released.');
    if (this.#result !== undefined) return this.#result;
    this.#retain(this.#stdout, this.#stdout.redaction.flush());
    this.#retain(this.#stderr, this.#stderr.redaction.flush());
    this.#stdout.redaction.dispose();
    this.#stderr.redaction.dispose();
    const stdout = this.#bytes(this.#stdout);
    const stderr = this.#bytes(this.#stderr);
    this.#result = Object.freeze({
      stderr,
      stdout,
      truncated: Object.freeze({
        stderr: this.#stderr.truncated,
        stdout: this.#stdout.truncated,
      }),
    });
    return this.#result;
  }

  #write(channel: OutputChannel, bytes: Uint8Array): void {
    if (this.#disposed || this.#result !== undefined) return;
    this.#retain(channel, channel.redaction.feed(bytes));
  }

  #retain(channel: OutputChannel, bytes: Uint8Array): void {
    const available = Math.max(0, this.#retainedLimit - this.#retainedBytes);
    const retained = bytes.subarray(0, available).slice();
    if (retained.byteLength > 0) channel.parts.push(retained);
    this.#retainedBytes += retained.byteLength;
    if (retained.byteLength < bytes.byteLength) channel.truncated = true;
  }

  #bytes(channel: OutputChannel): Uint8Array {
    return concatenate(channel.truncated ? [...channel.parts, truncationMarker] : channel.parts);
  }
}
