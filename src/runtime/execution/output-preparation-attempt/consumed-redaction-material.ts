import type { RegisteredSecrets } from '../secret-registration/index.js';

export class ConsumedRedactionMaterial {
  // oxlint-disable-next-line no-unused-private-class-members -- Section 10 will verify exact token identity; this slice only mints the carrier.
  readonly #invocationToken: object;
  readonly invocationId: string;
  // Write-only until the real InvocationOutputPort filesystem adapter slice, which is the
  // sole spec-legitimate reader (spec lines 334/336: the output adapter alone constructs
  // the three redaction front ends from this bundle). No reader ships in this slice.
  // oxlint-disable-next-line no-unused-private-class-members -- The future output adapter is the sole legitimate reader.
  readonly #redaction: RegisteredSecrets;

  private constructor(
    input: Readonly<{
      invocationId: string;
      invocationToken: object;
      redaction: RegisteredSecrets;
    }>,
  ) {
    this.#invocationToken = input.invocationToken;
    this.invocationId = input.invocationId;
    this.#redaction = input.redaction;
    Object.freeze(this);
  }

  static create(
    input: Readonly<{
      invocationId: string;
      invocationToken: object;
      redaction: RegisteredSecrets;
    }>,
  ): ConsumedRedactionMaterial {
    return new ConsumedRedactionMaterial(input);
  }
}
