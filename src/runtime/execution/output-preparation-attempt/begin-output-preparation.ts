import type { ConsumedOutputPreparationMaterial } from './consumed-output-preparation-material.js';
import type { ConsumedRedactionMaterial } from './consumed-redaction-material.js';
import type { OutputPreparationAttempt } from './output-preparation-attempt.js';
import { OUTPUT_PREPARATION_BEGINNERS } from './output-preparation-beginners.js';

export const beginOutputPreparation = (
  attempt: OutputPreparationAttempt,
  material: ConsumedOutputPreparationMaterial,
  redaction: ConsumedRedactionMaterial,
): void => {
  OUTPUT_PREPARATION_BEGINNERS.get(attempt)?.(material, redaction);
};
