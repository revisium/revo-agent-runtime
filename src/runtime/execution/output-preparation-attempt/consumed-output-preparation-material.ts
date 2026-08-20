import { InvocationBoundCarrier } from './invocation-bound-carrier.js';
import type { OutputPreparationFileSlot } from './output-preparation-file-slot.js';

export class ConsumedOutputPreparationMaterial extends InvocationBoundCarrier {
  #files: readonly OutputPreparationFileSlot[] | undefined;

  private constructor(
    input: Readonly<{
      invocationId: string;
      outputDirectory: string;
      invocationToken: object;
      files: readonly OutputPreparationFileSlot[];
    }>,
  ) {
    super(input);
    this.#files = input.files;
  }

  static create(
    input: Readonly<{
      invocationId: string;
      outputDirectory: string;
      invocationToken: object;
      files: readonly OutputPreparationFileSlot[];
    }>,
  ): ConsumedOutputPreparationMaterial {
    return new ConsumedOutputPreparationMaterial(input);
  }

  static take(material: unknown): readonly OutputPreparationFileSlot[] | undefined {
    if (!ConsumedOutputPreparationMaterial.isAuthentic(material)) return undefined;
    const files = material.#files;
    material.#files = undefined;
    return files;
  }

  static isAuthentic(material: unknown): material is ConsumedOutputPreparationMaterial {
    return typeof material === 'object' && material !== null && #files in material;
  }
}
