import type { RegisteredSecrets } from '../secret-registration/index.js';
import { ConsumedRedactionMaterial } from './consumed-redaction-material.js';

export const takeRegisteredSecretsForRedaction = (
  material: unknown,
): RegisteredSecrets | undefined => ConsumedRedactionMaterial.take(material);
