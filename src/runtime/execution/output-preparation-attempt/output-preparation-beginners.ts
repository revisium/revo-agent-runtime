import type { ConsumedOutputPreparationMaterial } from './consumed-output-preparation-material.js';
import type { ConsumedRedactionMaterial } from './consumed-redaction-material.js';
import type { OutputPreparationAttempt } from './output-preparation-attempt.js';

export const OUTPUT_PREPARATION_BEGINNERS = new WeakMap<
  OutputPreparationAttempt,
  (material: ConsumedOutputPreparationMaterial, redaction: ConsumedRedactionMaterial) => void
>();
