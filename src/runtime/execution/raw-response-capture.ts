import { BoundedRawResponseEvidence } from './bounded-raw-response-evidence.js';
import type { RawResponseCapture } from './raw-response-capture-port.js';
import type { RedactionChannel } from './redaction/index.js';

const appendBounded = (retained: Uint8Array, chunk: Uint8Array, maxBytes: number): Uint8Array => {
  if (retained.byteLength >= maxBytes || chunk.byteLength === 0) return retained;
  const available = maxBytes - retained.byteLength;
  const accepted = chunk.byteLength > available ? chunk.subarray(0, available) : chunk;
  const next = new Uint8Array(retained.byteLength + accepted.byteLength);
  next.set(retained);
  next.set(accepted, retained.byteLength);
  retained.fill(0);
  return next;
};

export const createRawResponseCapture = (input: {
  channel: RedactionChannel;
  maxRawResponseBytes: number;
  previewBytes: number;
}): RawResponseCapture => {
  let retained: Uint8Array = new Uint8Array(0);
  let byteLength = 0;
  let disposed = false;
  let taken: BoundedRawResponseEvidence | undefined;

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    retained.fill(0);
    retained = new Uint8Array(0);
    byteLength = 0;
    input.channel.dispose();
  };

  return Object.freeze({
    record: (bytes: Uint8Array): void => {
      if (disposed || taken !== undefined) return;
      const redacted = input.channel.feed(bytes);
      retained = appendBounded(retained, redacted, input.maxRawResponseBytes);
      byteLength += redacted.byteLength;
    },
    take: (): BoundedRawResponseEvidence => {
      if (taken !== undefined) return taken;
      if (!disposed) {
        const flushed = input.channel.flush();
        byteLength += flushed.byteLength;
        retained = appendBounded(retained, flushed, input.maxRawResponseBytes);
      }
      taken = BoundedRawResponseEvidence.create({
        byteLength,
        bytes: retained,
        previewBytes: input.previewBytes,
      });
      dispose();
      return taken;
    },
    dispose,
  });
};
