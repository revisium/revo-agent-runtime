import { ConsumedRedactionMaterial } from './consumed-redaction-material.js';

export const isConsumedRedactionMaterialBoundToToken = (
  material: unknown,
  token: object,
): boolean => ConsumedRedactionMaterial.isBoundToToken(material, token);
