import { createRedactionChannel } from '../security/redaction/channel.js';

const encoder = new TextEncoder();
export const OUTPUT_TRUNCATION_MARKER = encoder.encode('\n[output truncated]\n');

interface BoundedOutputResult {
  readonly bytes: Uint8Array;
  readonly truncated: boolean;
}

export interface BoundedOutput {
  write(chunk: Uint8Array): void;
  finalize(): BoundedOutputResult;
}

const appendRetained = (retained: Uint8Array, chunk: Uint8Array, maxBytes: number): Uint8Array => {
  const accepted = chunk.subarray(0, Math.max(0, maxBytes - retained.byteLength));
  const combined = new Uint8Array(retained.byteLength + accepted.byteLength);
  combined.set(retained);
  combined.set(accepted, retained.byteLength);
  return combined;
};

const utf8Prefix = (bytes: Uint8Array, maximum: number): Uint8Array => {
  let length = Math.min(bytes.byteLength, maximum);
  while (
    length > 0 &&
    length < bytes.byteLength &&
    bytes[length]! >= 0x80 &&
    bytes[length]! <= 0xbf
  )
    length -= 1;
  const lead = bytes[length];
  if (length < bytes.byteLength && lead! >= 0xc0 && length < maximum)
    return bytes.subarray(0, length);
  return bytes.subarray(0, Math.min(bytes.byteLength, maximum));
};

export const createBoundedOutput = (options: {
  readonly maxBytes: number;
  readonly secrets: readonly string[];
}): BoundedOutput => {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1)
    throw new TypeError('Output byte limit must be a positive safe integer.');
  const redaction = createRedactionChannel(options.secrets);
  let retained: Uint8Array = new Uint8Array();
  let byteLength = 0;
  let result: BoundedOutputResult | undefined;

  const record = (chunk: Uint8Array): void => {
    byteLength += chunk.byteLength;
    retained = appendRetained(retained, chunk, options.maxBytes);
  };

  return Object.freeze({
    write: (chunk: Uint8Array): void => {
      if (result !== undefined) return;
      record(redaction.feed(chunk));
    },
    finalize: (): BoundedOutputResult => {
      if (result !== undefined) return result;
      record(redaction.flush());
      redaction.dispose();
      if (byteLength <= options.maxBytes) {
        result = Object.freeze({ bytes: retained.slice(), truncated: false });
        return result;
      }
      if (options.maxBytes < OUTPUT_TRUNCATION_MARKER.byteLength)
        throw new TypeError('Output byte limit cannot reserve the truncation marker.');
      const prefix = utf8Prefix(retained, options.maxBytes - OUTPUT_TRUNCATION_MARKER.byteLength);
      const bytes = new Uint8Array(prefix.byteLength + OUTPUT_TRUNCATION_MARKER.byteLength);
      bytes.set(prefix);
      bytes.set(OUTPUT_TRUNCATION_MARKER, prefix.byteLength);
      result = Object.freeze({ bytes, truncated: true });
      return result;
    },
  });
};
