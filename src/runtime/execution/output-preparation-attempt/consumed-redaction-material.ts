import type { RegisteredSecrets } from '../secret-registration/index.js';

export class ConsumedRedactionMaterial {
  readonly #invocationToken: object;
  readonly invocationId: string;
  // Taken exactly once by the real InvocationOutputPort filesystem adapter slice, the sole
  // spec-legitimate reader (spec lines 334/336: the output adapter alone constructs the
  // three redaction front ends from this bundle). No production caller ships in this slice.
  #redaction: RegisteredSecrets | undefined;

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

  static take(material: unknown): RegisteredSecrets | undefined {
    if (!ConsumedRedactionMaterial.isAuthentic(material)) return undefined;
    const redaction = material.#redaction;
    material.#redaction = undefined;
    return redaction;
  }

  // The eventual section 10 finalizer's "exact token identity" check (spec line 758)
  // against the shared per-invocation token network this material was minted with.
  static isBoundToToken(material: unknown, token: object): boolean {
    return ConsumedRedactionMaterial.isAuthentic(material) && material.#invocationToken === token;
  }

  static isAuthentic(material: unknown): material is ConsumedRedactionMaterial {
    return (
      typeof material === 'object' &&
      material !== null &&
      #invocationToken in material &&
      material.#invocationToken !== undefined
    );
  }
}
