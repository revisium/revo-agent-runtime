import type { AgentRawResponseDiagnostic } from '../../contracts/manager.js';
import { createRedactionChannel } from '../security/redaction/channel.js';

const previewDecoder = new TextDecoder('utf-8', { fatal: false });

export class RawResponseEvidence {
  readonly diagnostic: AgentRawResponseDiagnostic;
  readonly observations: number;
  readonly #bytes: Uint8Array;

  constructor(input: {
    readonly byteLength: number;
    readonly bytes: Uint8Array;
    readonly observations: number;
    readonly previewBytes: number;
  }) {
    this.#bytes = input.bytes.slice();
    this.observations = input.observations;
    this.diagnostic = Object.freeze({
      byteLength: input.byteLength,
      preview: previewDecoder.decode(this.#bytes.subarray(0, input.previewBytes)),
      retainedByteLength: this.#bytes.byteLength,
      truncated: input.byteLength > this.#bytes.byteLength,
    });
    Object.freeze(this);
  }

  bytes(): Uint8Array {
    return this.#bytes.slice();
  }
}

const appendBounded = (retained: Uint8Array, chunk: Uint8Array, maxBytes: number): Uint8Array => {
  const accepted = chunk.subarray(0, Math.max(0, maxBytes - retained.byteLength));
  const combined = new Uint8Array(retained.byteLength + accepted.byteLength);
  combined.set(retained);
  combined.set(accepted, retained.byteLength);
  return combined;
};

export const createRawResponseCapture = (options: {
  readonly maxBytes: number;
  readonly previewBytes: number;
  readonly secrets: readonly string[];
}) => {
  const redaction = createRedactionChannel(options.secrets);
  let retained: Uint8Array = new Uint8Array();
  let byteLength = 0;
  let observations = 0;
  let evidence: RawResponseEvidence | undefined;

  const retain = (chunk: Uint8Array): void => {
    byteLength += chunk.byteLength;
    retained = appendBounded(retained, chunk, options.maxBytes);
  };

  return Object.freeze({
    record: (chunk: Uint8Array): void => {
      if (evidence !== undefined) return;
      observations += 1;
      retain(redaction.feed(chunk));
    },
    take: (): RawResponseEvidence => {
      if (evidence !== undefined) return evidence;
      retain(redaction.flush());
      redaction.dispose();
      evidence = new RawResponseEvidence({
        byteLength,
        bytes: retained,
        observations,
        previewBytes: options.previewBytes,
      });
      return evidence;
    },
  });
};
