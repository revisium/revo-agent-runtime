import type { ConsumedOutputPreparationMaterial } from './consumed-output-preparation-material.js';
import type { ConsumedRedactionMaterial } from './consumed-redaction-material.js';

export interface OutputPreparationMutationRequest {
  readonly invocationId: string;
  readonly outputDirectory: string;
  readonly material: ConsumedOutputPreparationMaterial;
  readonly redaction: ConsumedRedactionMaterial;
  markMutationDispatched(): void;
}
