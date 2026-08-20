import { ConsumedOutputPreparationMaterial } from './consumed-output-preparation-material.js';
import { InvocationBoundCarrier } from './invocation-bound-carrier.js';

export const isConsumedOutputPreparationMaterialBoundToToken = (
  material: unknown,
  token: object,
): boolean =>
  // Both checks are load-bearing: dropping either reopens authority confusion between sibling InvocationBoundCarrier types.
  ConsumedOutputPreparationMaterial.isAuthentic(material) &&
  InvocationBoundCarrier.isBoundToToken(material, token);
