import { ConsumedOutputPreparationMaterial } from './consumed-output-preparation-material.js';
import type { OutputPreparationFileSlot } from './output-preparation-file-slot.js';

export const takeOutputPreparationFileSlots = (
  material: unknown,
): readonly OutputPreparationFileSlot[] | undefined =>
  ConsumedOutputPreparationMaterial.take(material);
