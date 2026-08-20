import { ConsumedRedactionMaterial } from '../output-preparation-attempt/consumed-redaction-material.js';
import { getOutputPreparationInvocationToken } from '../output-preparation-attempt/index.js';
import { PreparedExecutionSecurity } from './prepared-execution-security.js';

export const consumeRedactionMaterial = (
  capability: unknown,
  attempt: unknown,
): ConsumedRedactionMaterial | undefined => {
  if (!PreparedExecutionSecurity.isAuthentic(capability)) return undefined;
  const invocationToken = getOutputPreparationInvocationToken(attempt);
  if (invocationToken === undefined) return undefined;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- attempt is unknown; only this informational field is read after registry authentication.
  if (capability.invocationId !== (attempt as { invocationId?: unknown }).invocationId)
    return undefined;
  const taken = PreparedExecutionSecurity.takeRedaction(capability);
  if (taken === undefined) return undefined;
  return ConsumedRedactionMaterial.create({
    invocationId: taken.invocationId,
    invocationToken,
    redaction: taken.redaction,
  });
};
