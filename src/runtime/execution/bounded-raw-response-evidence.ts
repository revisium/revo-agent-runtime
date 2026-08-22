import type { RawResponseEvidenceView } from './raw-response-evidence-view.js';

const previewDecoder = new TextDecoder('utf-8', { fatal: false });

export class BoundedRawResponseEvidence {
  readonly view: RawResponseEvidenceView;
  #bytes: Uint8Array | undefined;

  private constructor(
    input: Readonly<{
      byteLength: number;
      bytes: Uint8Array;
      previewBytes: number;
    }>,
  ) {
    this.#bytes = new Uint8Array(input.bytes);
    const previewLength = Math.min(input.previewBytes, this.#bytes.byteLength);
    this.view = Object.freeze({
      byteLength: input.byteLength,
      retainedByteLength: this.#bytes.byteLength,
      truncated: this.#bytes.byteLength < input.byteLength,
      preview: previewDecoder.decode(this.#bytes.subarray(0, previewLength)),
    });
    Object.freeze(this);
  }

  static create(
    input: Readonly<{
      byteLength: number;
      bytes: Uint8Array;
      previewBytes: number;
    }>,
  ): BoundedRawResponseEvidence {
    return new BoundedRawResponseEvidence(input);
  }

  static take(evidence: unknown): Uint8Array | undefined {
    if (!BoundedRawResponseEvidence.isAuthentic(evidence)) return undefined;
    const bytes = evidence.#bytes;
    if (bytes === undefined) return undefined;
    const taken = new Uint8Array(bytes);
    bytes.fill(0);
    evidence.#bytes = undefined;
    return taken;
  }

  static peek(evidence: unknown): Uint8Array | undefined {
    if (!BoundedRawResponseEvidence.isAuthentic(evidence)) return undefined;
    const bytes = evidence.#bytes;
    return bytes === undefined ? undefined : new Uint8Array(bytes);
  }

  static isAuthentic(evidence: unknown): evidence is BoundedRawResponseEvidence {
    return typeof evidence === 'object' && evidence !== null && #bytes in evidence;
  }
}
